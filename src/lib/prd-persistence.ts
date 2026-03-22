import type { AppSupabase } from '@/lib/artifact-persistence';
import type { Database } from '@/lib/database.types';

type FeatureStatus = Database['public']['Tables']['features']['Update']['status'];

export async function patchFeatureStatus(
  sb: AppSupabase,
  featureId: string,
  status: NonNullable<FeatureStatus>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await sb
    .from('features')
    .update({ status })
    .eq('id', featureId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
