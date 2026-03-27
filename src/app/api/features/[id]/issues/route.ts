import { requireUser } from '@/lib/auth/require-user';
import type { FeatureIssue } from '@/lib/database.types';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;

  const { data: feature, error: fe } = await sb.from('features').select('id').eq('id', featureId).single();
  if (fe || !feature) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  }

  const { data, error } = await sb
    .from('feature_issues')
    .select('*')
    .eq('feature_id', featureId)
    .order('type', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as FeatureIssue[];
  const epic = rows.find((r) => r.type === 'epic');
  const stories = rows.filter((r) => r.type === 'story');

  return NextResponse.json({ epic: epic ?? null, stories });
}
