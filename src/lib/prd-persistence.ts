import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

type FeatureStatus = Database['public']['Tables']['features']['Update']['status'];

export async function patchFeatureStatus(
  featureId: string,
  status: NonNullable<FeatureStatus>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase
    .from('features')
    .update({ status })
    .eq('id', featureId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
