import { requireUser } from '@/lib/auth/require-user';
import type { FeatureIssue } from '@/lib/database.types';
import { NextResponse } from 'next/server';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId, issueId } = await params;
  const sb = auth.supabase;

  let body: {
    title?: string;
    description?: string;
    acceptance_criteria?: string[];
    status?: FeatureIssue['status'];
    priority?: FeatureIssue['priority'];
    due_date?: string | null;
    sort_order?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.title !== undefined) update.title = body.title;
  if (body.description !== undefined) update.description = body.description;
  if (body.acceptance_criteria !== undefined) update.acceptance_criteria = body.acceptance_criteria;
  if (body.status !== undefined) update.status = body.status;
  if (body.priority !== undefined) update.priority = body.priority;
  if (body.due_date !== undefined) update.due_date = body.due_date;
  if (body.sort_order !== undefined) update.sort_order = body.sort_order;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('feature_issues')
    .update(update)
    .eq('id', issueId)
    .eq('feature_id', featureId)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
