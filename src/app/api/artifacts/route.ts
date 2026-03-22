import { requireUser } from '@/lib/auth/require-user';
import { NextResponse } from 'next/server';

const LIST_LIMIT = 200;

type JoinedArtifactRow = {
  id: string;
  feature_id: string;
  kind: string;
  title: string | null;
  version: number;
  updated_at: string;
  created_at: string;
  features: {
    id: string;
    name: string;
    workspace_id: string;
    workspaces: { id: string; name: string } | null;
  };
};

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from('feature_artifacts')
    .select(
      `
      id,
      feature_id,
      kind,
      title,
      version,
      updated_at,
      created_at,
      features!inner (
        id,
        name,
        workspace_id,
        workspaces (
          id,
          name
        )
      )
    `,
    )
    .eq('is_draft', false)
    .order('updated_at', { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as unknown as JoinedArtifactRow[];
  const flat = rows.map((row) => {
    const f = row.features;
    const ws = f?.workspaces;
    return {
      id: row.id,
      feature_id: row.feature_id,
      kind: row.kind,
      title: row.title,
      version: row.version,
      updated_at: row.updated_at,
      created_at: row.created_at,
      feature_name: f?.name ?? null,
      workspace_id: f?.workspace_id ?? null,
      workspace_name: ws?.name ?? null,
    };
  });

  return NextResponse.json(flat);
}
