import {
  beginPrdDraftSession,
  finalizeOpenPrdDraft,
  getLatestCompletedPrdRow,
  replaceLatestCompletedPrdBody,
  upsertOpenPrdDraftBody,
  type AppSupabase,
} from '@/lib/artifact-persistence';
import { requireUser } from '@/lib/auth/require-user';
import { NextResponse } from 'next/server';

async function legacyPrdContent(
  sb: AppSupabase,
  featureId: string,
): Promise<string | null> {
  const { data } = await sb
    .from('prd_documents')
    .select('content')
    .eq('feature_id', featureId)
    .maybeSingle();
  return data?.content ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;

  const row = await getLatestCompletedPrdRow(sb, featureId);
  if (row) {
    return NextResponse.json({
      id: row.id,
      content: row.body ?? '',
      feature_id: row.feature_id,
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  const legacy = await legacyPrdContent(sb, featureId);
  if (legacy !== null && legacy.length > 0) {
    const { data: doc } = await sb
      .from('prd_documents')
      .select('*')
      .eq('feature_id', featureId)
      .single();
    if (doc) return NextResponse.json(doc);
  }

  return NextResponse.json({ error: 'PRD not found' }, { status: 404 });
}

/**
 * POST: sendBeacon partial save during unload, or begin a new PRD draft session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;
  let body: { content?: string; beginDraft?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.beginDraft === true) {
    const result = await beginPrdDraftSession(sb, featureId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(
      { id: result.row.id, version: result.row.version },
      { status: 201 },
    );
  }

  const content = body.content;
  if (content === undefined) {
    return NextResponse.json(
      { error: 'content or beginDraft is required' },
      { status: 400 },
    );
  }

  const result = await upsertOpenPrdDraftBody(sb, featureId, content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;
  let body: { content?: string; finalize?: boolean; replaceLatest?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const content = body.content;
  if (content === undefined) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  if (body.replaceLatest === true) {
    const result = await replaceLatestCompletedPrdBody(sb, featureId, content);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json(result.row);
  }

  if (body.finalize === true) {
    const result = await finalizeOpenPrdDraft(sb, featureId, content);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    return NextResponse.json({
      id: result.row.id,
      version: result.row.version,
      feature_id: result.row.feature_id,
      content: result.row.body ?? '',
      created_at: result.row.created_at,
      updated_at: result.row.updated_at,
    });
  }

  const result = await upsertOpenPrdDraftBody(sb, featureId, content);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result.row);
}
