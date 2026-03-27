import { requireUser } from '@/lib/auth/require-user';
import type { FeatureIssue } from '@/lib/database.types';
import { NextResponse } from 'next/server';

const EPIC_KEY = 'EPIC';

function sanitizeIssueKey(ref: string): string {
  const t = ref.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '-').replace(/^-|-$/g, '');
  return t.slice(0, 64) || 'STORY';
}

function storyDescription(parts: {
  persona: string;
  narrative: string;
  notes: string;
}): string {
  const blocks: string[] = [];
  if (parts.persona) blocks.push(`**Persona:** ${parts.persona}`);
  if (parts.narrative) blocks.push(parts.narrative);
  if (parts.notes) blocks.push(`**Notes:** ${parts.notes}`);
  return blocks.join('\n\n').trim();
}

type CommitStory = {
  externalRef?: string;
  title: string;
  persona?: string;
  narrative?: string;
  /** Direct body (inference-driven generation). */
  description?: string;
  acceptanceCriteria?: string[];
  notes?: string;
  due_date?: string | null;
  status?: FeatureIssue['status'];
  priority?: FeatureIssue['priority'];
  include?: boolean;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;

  let body: {
    replace?: boolean;
    generated_from?: 'inference_competitor' | 'manual' | 'prd_import';
    epic: {
      title: string;
      description: string;
      acceptance_criteria?: string[];
      due_date?: string | null;
    };
    stories: CommitStory[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.epic?.title?.trim()) {
    return NextResponse.json({ error: 'Epic title is required' }, { status: 400 });
  }
  if (!Array.isArray(body.stories)) {
    return NextResponse.json({ error: 'stories array is required' }, { status: 400 });
  }

  const { data: feature, error: fe } = await sb.from('features').select('id').eq('id', featureId).single();
  if (fe || !feature) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  }

  const included = body.stories.filter((s) => s.include !== false && s.title?.trim());
  if (included.length === 0) {
    return NextResponse.json({ error: 'Select at least one story' }, { status: 400 });
  }

  const { data: existing } = await sb.from('feature_issues').select('id').eq('feature_id', featureId).limit(1);

  if (existing && existing.length > 0 && !body.replace) {
    return NextResponse.json(
      { error: 'Issues already exist for this feature. Pass replace: true to overwrite.' },
      { status: 409 },
    );
  }

  if (existing && existing.length > 0 && body.replace) {
    const { error: delErr } = await sb.from('feature_issues').delete().eq('feature_id', featureId);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
  }

  const generatedFrom = body.generated_from ?? 'manual';

  const epicAc = Array.isArray(body.epic.acceptance_criteria) ? body.epic.acceptance_criteria : [];

  const { data: epicRow, error: epicErr } = await sb
    .from('feature_issues')
    .insert({
      feature_id: featureId,
      parent_id: null,
      type: 'epic',
      issue_key: EPIC_KEY,
      title: body.epic.title.trim(),
      description: body.epic.description ?? '',
      acceptance_criteria: epicAc,
      status: 'open',
      priority: 'medium',
      due_date: body.epic.due_date ?? null,
      generated_from: generatedFrom,
      sort_order: 0,
    })
    .select()
    .single();

  if (epicErr || !epicRow) {
    return NextResponse.json({ error: epicErr?.message ?? 'Failed to create epic' }, { status: 500 });
  }

  const epic = epicRow as FeatureIssue;
  const usedKeys = new Set<string>([EPIC_KEY]);
  const inserted: FeatureIssue[] = [epic];

  let order = 0;
  for (const s of included) {
    const base = sanitizeIssueKey(s.externalRef || s.title);
    let n = 0;
    let key = base;
    while (usedKeys.has(key)) {
      n += 1;
      key = `${base}-${n}`;
    }
    usedKeys.add(key);

    const desc =
      typeof s.description === 'string' && s.description.trim()
        ? s.description.trim()
        : storyDescription({
            persona: s.persona ?? '',
            narrative: s.narrative ?? '',
            notes: s.notes ?? '',
          });

    const { data: storyRow, error: storyErr } = await sb
      .from('feature_issues')
      .insert({
        feature_id: featureId,
        parent_id: epic.id,
        type: 'story',
        issue_key: key,
        title: s.title.trim(),
        description: desc,
        acceptance_criteria: Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [],
        status: s.status ?? 'open',
        priority: s.priority ?? 'medium',
        due_date: s.due_date ?? null,
        generated_from: generatedFrom,
        sort_order: order++,
      })
      .select()
      .single();

    if (storyErr || !storyRow) {
      await sb.from('feature_issues').delete().eq('feature_id', featureId);
      return NextResponse.json({ error: storyErr?.message ?? 'Failed to create story' }, { status: 500 });
    }
    inserted.push(storyRow as FeatureIssue);
  }

  return NextResponse.json({ issues: inserted });
}
