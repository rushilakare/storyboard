import { setArtifactSourceMessage } from '@/lib/artifact-persistence';
import { requireUser } from '@/lib/auth/require-user';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId, artifactId } = await params;

  const { data: row, error } = await auth.supabase
    .from('feature_artifacts')
    .select(
      'id, feature_id, kind, title, body, mime_type, version, is_draft',
    )
    .eq('id', artifactId)
    .eq('feature_id', featureId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    feature_id: row.feature_id,
    kind: row.kind,
    title: row.title,
    mime_type: row.mime_type,
    version: row.version,
    body: row.body ?? '',
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId, artifactId } = await params;
  let body: { source_message_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const sourceMessageId = body.source_message_id;
  if (!sourceMessageId || typeof sourceMessageId !== 'string') {
    return NextResponse.json(
      { error: 'source_message_id is required' },
      { status: 400 },
    );
  }

  const { data: row, error: verifyErr } = await auth.supabase
    .from('feature_artifacts')
    .select('id')
    .eq('id', artifactId)
    .eq('feature_id', featureId)
    .maybeSingle();

  if (verifyErr || !row) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
  }

  const result = await setArtifactSourceMessage(
    auth.supabase,
    artifactId,
    sourceMessageId,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
