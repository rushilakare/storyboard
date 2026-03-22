import { requireUser } from '@/lib/auth/require-user';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: workspaceId } = await params;

  const { data: ws, error: wsErr } = await auth.supabase
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .maybeSingle();

  if (wsErr) {
    return NextResponse.json({ error: wsErr.message }, { status: 500 });
  }
  if (!ws) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
  }

  const { data: feats, error: fErr } = await auth.supabase
    .from('features')
    .select('id, name')
    .eq('workspace_id', workspaceId);

  if (fErr) {
    return NextResponse.json({ error: fErr.message }, { status: 500 });
  }

  const ids = feats?.map((f) => f.id) ?? [];
  if (ids.length === 0) {
    return NextResponse.json([]);
  }

  const { data: rows, error } = await auth.supabase
    .from('feature_artifacts')
    .select('id, feature_id, kind, title, version, updated_at, created_at')
    .in('feature_id', ids)
    .eq('is_draft', false)
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const nameById = new Map((feats ?? []).map((f) => [f.id, f.name] as const));
  const enriched = (rows ?? []).map((r) => ({
    ...r,
    feature_name: nameById.get(r.feature_id) ?? null,
    workspace_id: workspaceId,
  }));

  return NextResponse.json(enriched);
}
