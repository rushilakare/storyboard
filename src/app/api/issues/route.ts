import { requireUser } from '@/lib/auth/require-user';
import type { FeatureIssue } from '@/lib/database.types';
import { NextResponse } from 'next/server';

export type IssueListRow = FeatureIssue & {
  feature_name: string;
  workspace_id: string;
  workspace_name: string;
};

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sb = auth.supabase;
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspace_id');

  const { data, error } = await sb
    .from('feature_issues')
    .select(
      `
      *,
      features (
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
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data ?? []) as Record<string, unknown>[];

  const issues: IssueListRow[] = [];
  for (const row of raw) {
    const f = row.features as
      | {
          id: string;
          name: string;
          workspace_id: string;
          workspaces: { id: string; name: string } | null;
        }
      | null;
    if (!f?.workspaces) continue;
    if (workspaceId && f.workspace_id !== workspaceId) continue;
    const issueRow = { ...row } as Record<string, unknown>;
    delete issueRow.features;
    issues.push({
      ...(issueRow as unknown as FeatureIssue),
      feature_name: f.name,
      workspace_id: f.workspaces.id,
      workspace_name: f.workspaces.name,
    });
  }

  return NextResponse.json({ issues });
}
