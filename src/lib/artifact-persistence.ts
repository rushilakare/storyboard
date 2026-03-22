import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export type AppSupabase = SupabaseClient<Database>;

export const ARTIFACT_KIND_PRD = 'prd' as const;

export type FeatureArtifactRow = {
  id: string;
  feature_id: string;
  kind: string;
  mime_type: string;
  title: string | null;
  body: string | null;
  storage_path: string | null;
  version: number;
  is_draft: boolean;
  source_message_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

async function nextArtifactVersion(
  sb: AppSupabase,
  featureId: string,
  kind: string,
): Promise<number> {
  const { data, error } = await sb
    .from('feature_artifacts')
    .select('version')
    .eq('feature_id', featureId)
    .eq('kind', kind)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.version ?? 0) + 1;
}

/**
 * Close any open PRD draft (abandoned streams become a normal version), then insert a new draft row.
 */
export async function beginPrdDraftSession(
  sb: AppSupabase,
  featureId: string,
): Promise<{ ok: true; row: FeatureArtifactRow } | { ok: false; error: string }> {
  const { error: closeErr } = await sb
    .from('feature_artifacts')
    .update({ is_draft: false })
    .eq('feature_id', featureId)
    .eq('kind', ARTIFACT_KIND_PRD)
    .eq('is_draft', true);

  if (closeErr) return { ok: false, error: closeErr.message };

  let version: number;
  try {
    version = await nextArtifactVersion(sb, featureId, ARTIFACT_KIND_PRD);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'version lookup failed' };
  }

  const { data, error } = await sb
    .from('feature_artifacts')
    .insert({
      feature_id: featureId,
      kind: ARTIFACT_KIND_PRD,
      mime_type: 'text/markdown',
      title: 'PRD',
      body: '',
      version,
      is_draft: true,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data as FeatureArtifactRow };
}

/**
 * Update the open PRD draft body (streaming autosave). If no draft exists, creates one (recovery path).
 */
export async function upsertOpenPrdDraftBody(
  sb: AppSupabase,
  featureId: string,
  content: string,
): Promise<{ ok: true; row: FeatureArtifactRow } | { ok: false; error: string }> {
  const { data: open, error: openErr } = await sb
    .from('feature_artifacts')
    .select('id, version')
    .eq('feature_id', featureId)
    .eq('kind', ARTIFACT_KIND_PRD)
    .eq('is_draft', true)
    .limit(1)
    .maybeSingle();

  if (openErr) return { ok: false, error: openErr.message };

  if (open) {
    const { data, error } = await sb
      .from('feature_artifacts')
      .update({ body: content })
      .eq('id', open.id)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, row: data as FeatureArtifactRow };
  }

  const begun = await beginPrdDraftSession(sb, featureId);
  if (!begun.ok) return begun;

  const { data, error } = await sb
    .from('feature_artifacts')
    .update({ body: content })
    .eq('id', begun.row.id)
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data as FeatureArtifactRow };
}

/**
 * Set final body and mark the open draft completed (new saved version).
 */
export async function finalizeOpenPrdDraft(
  sb: AppSupabase,
  featureId: string,
  content: string,
): Promise<{ ok: true; row: FeatureArtifactRow } | { ok: false; error: string }> {
  const { data: open, error: openErr } = await sb
    .from('feature_artifacts')
    .select('id')
    .eq('feature_id', featureId)
    .eq('kind', ARTIFACT_KIND_PRD)
    .eq('is_draft', true)
    .limit(1)
    .maybeSingle();

  if (openErr) return { ok: false, error: openErr.message };

  if (open) {
    const { data, error } = await sb
      .from('feature_artifacts')
      .update({ body: content, is_draft: false })
      .eq('id', open.id)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, row: data as FeatureArtifactRow };
  }

  const latest = await getLatestCompletedPrdRow(sb, featureId);
  if (latest && (latest.body ?? '') === content) {
    return { ok: true, row: latest };
  }

  const version = await nextArtifactVersion(sb, featureId, ARTIFACT_KIND_PRD);
  const { data, error } = await sb
    .from('feature_artifacts')
    .insert({
      feature_id: featureId,
      kind: ARTIFACT_KIND_PRD,
      mime_type: 'text/markdown',
      title: 'PRD',
      body: content,
      version,
      is_draft: false,
    })
    .select()
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, row: data as FeatureArtifactRow };
}

/** User edits in the PRD panel: update the latest completed revision without bumping version. */
export async function replaceLatestCompletedPrdBody(
  sb: AppSupabase,
  featureId: string,
  content: string,
): Promise<{ ok: true; row: FeatureArtifactRow } | { ok: false; error: string }> {
  const latest = await getLatestCompletedPrdRow(sb, featureId);
  if (latest) {
    const { data, error } = await sb
      .from('feature_artifacts')
      .update({ body: content })
      .eq('id', latest.id)
      .select()
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, row: data as FeatureArtifactRow };
  }
  return finalizeOpenPrdDraft(sb, featureId, content);
}

export async function getLatestCompletedPrdRow(
  sb: AppSupabase,
  featureId: string,
): Promise<FeatureArtifactRow | null> {
  const { data, error } = await sb
    .from('feature_artifacts')
    .select()
    .eq('feature_id', featureId)
    .eq('kind', ARTIFACT_KIND_PRD)
    .eq('is_draft', false)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as FeatureArtifactRow;
}

export async function getLatestCompletedPrdContent(
  sb: AppSupabase,
  featureId: string,
): Promise<string> {
  const row = await getLatestCompletedPrdRow(sb, featureId);
  return row?.body ?? '';
}

/** Prefer versioned artifacts; fall back to legacy `prd_documents` until backfill/migration. */
export async function resolvePrdContentForFeature(
  sb: AppSupabase,
  featureId: string,
): Promise<string> {
  const fromArtifact = await getLatestCompletedPrdContent(sb, featureId);
  if (fromArtifact.length > 0) return fromArtifact;

  const { data } = await sb
    .from('prd_documents')
    .select('content')
    .eq('feature_id', featureId)
    .maybeSingle();

  return data?.content ?? '';
}

export async function listFeatureArtifacts(
  sb: AppSupabase,
  featureId: string,
  kind?: string,
): Promise<FeatureArtifactRow[]> {
  let q = sb.from('feature_artifacts').select().eq('feature_id', featureId);
  if (kind) {
    q = q.eq('kind', kind).order('version', { ascending: false }).order('created_at', { ascending: false });
  } else {
    q = q.order('created_at', { ascending: false });
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as FeatureArtifactRow[];
}

export async function setArtifactSourceMessage(
  sb: AppSupabase,
  artifactId: string,
  sourceMessageId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await sb
    .from('feature_artifacts')
    .update({ source_message_id: sourceMessageId })
    .eq('id', artifactId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
