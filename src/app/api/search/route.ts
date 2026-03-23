import { requireUser } from '@/lib/auth/require-user';
import { listArtifactsFlat } from '@/lib/search/artifactsFlatList';
import { ilikeContainsPattern } from '@/lib/search/escapeIlike';
import { NextRequest, NextResponse } from 'next/server';

const SECTION_LIMIT = 10;

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const qRaw = request.nextUrl.searchParams.get('q') ?? '';
  const q = qRaw.trim();

  if (!q) {
    return NextResponse.json({
      query: qRaw,
      workspaces: [],
      features: [],
      knowledge: [],
      artifacts: [],
    });
  }

  const p = ilikeContainsPattern(q);
  const sb = auth.supabase;

  const [wsRes, featRes, knowRes, artRes] = await Promise.all([
    sb
      .from('workspaces')
      .select('id, name, description')
      .or(`name.ilike.${p},description.ilike.${p}`)
      .order('updated_at', { ascending: false })
      .limit(SECTION_LIMIT),
    sb
      .from('features')
      .select('id, name, workspace_id, status')
      .or(`name.ilike.${p},purpose.ilike.${p},requirements.ilike.${p}`)
      .order('updated_at', { ascending: false })
      .limit(SECTION_LIMIT),
    sb
      .from('knowledge_documents')
      .select('id, filename, title, status')
      .or(
        `filename.ilike.${p},title.ilike.${p},source_kind.ilike.${p},status.ilike.${p},mime_type.ilike.${p}`,
      )
      .order('created_at', { ascending: false })
      .limit(SECTION_LIMIT),
    listArtifactsFlat(sb, { q, maxRows: SECTION_LIMIT }),
  ]);

  if (wsRes.error) {
    return NextResponse.json({ error: wsRes.error.message }, { status: 500 });
  }
  if (featRes.error) {
    return NextResponse.json({ error: featRes.error.message }, { status: 500 });
  }
  if (knowRes.error) {
    return NextResponse.json({ error: knowRes.error.message }, { status: 500 });
  }
  if (artRes.error) {
    return NextResponse.json({ error: artRes.error }, { status: 500 });
  }

  const workspaces = (wsRes.data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    href: `/workspaces/${w.id}`,
  }));

  const features = (featRes.data ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    workspace_id: f.workspace_id,
    status: f.status,
    href: `/workspaces/${f.workspace_id}?feature=${f.id}`,
  }));

  const knowledge = (knowRes.data ?? []).map((k) => ({
    id: k.id,
    filename: k.filename,
    title: k.title,
    status: k.status,
    href: `/knowledge?highlight=${k.id}`,
  }));

  const artifacts = (artRes.data ?? [])
    .filter((a) => a.workspace_id)
    .map((a) => ({
      id: a.id,
      feature_id: a.feature_id,
      title: a.title,
      kind: a.kind,
      workspace_id: a.workspace_id,
      feature_name: a.feature_name,
      workspace_name: a.workspace_name,
      href: `/workspaces/${a.workspace_id}?feature=${a.feature_id}`,
    }));

  return NextResponse.json({
    query: q,
    workspaces,
    features,
    knowledge,
    artifacts,
  });
}
