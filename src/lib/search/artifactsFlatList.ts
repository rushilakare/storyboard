import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { ilikeContainsPattern } from '@/lib/search/escapeIlike';

const JOINED_SELECT = `
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
`;

export type JoinedArtifactRow = {
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

export type FlatArtifactListItem = {
  id: string;
  feature_id: string;
  kind: string;
  title: string | null;
  version: number;
  updated_at: string;
  created_at: string;
  feature_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
};

function flattenRow(row: JoinedArtifactRow): FlatArtifactListItem {
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
}

function byUpdatedDesc(a: FlatArtifactListItem, b: FlatArtifactListItem) {
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

/** Cap IN list size for PostgREST URL limits. */
const MAX_FEATURE_IDS_IN = 400;

/**
 * Non-draft artifacts visible to the user (RLS), optionally filtered by metadata
 * (title, kind, feature name, workspace name). Does not search artifact body.
 */
export async function listArtifactsFlat(
  sb: SupabaseClient<Database>,
  options: { q: string | undefined | null; maxRows: number },
): Promise<{ data: FlatArtifactListItem[]; error: string | null }> {
  const trimmed = options.q?.trim() ?? '';
  const maxRows = options.maxRows;

  const base = () =>
    sb
      .from('feature_artifacts')
      .select(JOINED_SELECT)
      .eq('is_draft', false);

  if (!trimmed) {
    const { data, error } = await base()
      .order('updated_at', { ascending: false })
      .limit(maxRows);
    if (error) return { data: [], error: error.message };
    const rows = (data ?? []) as unknown as JoinedArtifactRow[];
    return { data: rows.map(flattenRow), error: null };
  }

  const p = ilikeContainsPattern(trimmed);
  const orArtifact = `title.ilike.${p},kind.ilike.${p}`;

  const [r1, rFeatsName, rWs] = await Promise.all([
    base().or(orArtifact).order('updated_at', { ascending: false }).limit(maxRows),
    sb.from('features').select('id').ilike('name', p),
    sb.from('workspaces').select('id').ilike('name', p),
  ]);

  if (r1.error) return { data: [], error: r1.error.message };

  const featIdsFromMeta = new Set<string>();
  if (!rFeatsName.error) {
    for (const x of rFeatsName.data ?? []) {
      if (typeof x.id === 'string') featIdsFromMeta.add(x.id);
    }
  }
  if (!rWs.error && (rWs.data?.length ?? 0) > 0) {
    const wsIds = (rWs.data ?? []).map((x) => x.id).filter((id): id is string => typeof id === 'string');
    if (wsIds.length > 0) {
      const rFeatsWs = await sb.from('features').select('id').in('workspace_id', wsIds);
      if (!rFeatsWs.error) {
        for (const x of rFeatsWs.data ?? []) {
          if (typeof x.id === 'string') featIdsFromMeta.add(x.id);
        }
      }
    }
  }

  const ids = [...featIdsFromMeta].slice(0, MAX_FEATURE_IDS_IN);

  let rows2: JoinedArtifactRow[] = [];
  if (ids.length > 0) {
    const res = await base()
      .in('feature_id', ids)
      .order('updated_at', { ascending: false })
      .limit(maxRows);
    if (res.error) return { data: [], error: res.error.message };
    rows2 = (res.data ?? []) as unknown as JoinedArtifactRow[];
  }

  const rows1 = (r1.data ?? []) as unknown as JoinedArtifactRow[];
  const merged = new Map<string, FlatArtifactListItem>();
  for (const row of [...rows1, ...rows2]) {
    merged.set(row.id, flattenRow(row));
  }
  const data = [...merged.values()].sort(byUpdatedDesc).slice(0, maxRows);
  return { data, error: null };
}
