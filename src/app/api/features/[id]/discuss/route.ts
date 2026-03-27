import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  formatAnswerForQuestion,
  isInferenceClarificationsV2,
  type ClarifyingQuestion,
} from '@/lib/postInferenceQuestions';
import { requireUser } from '@/lib/auth/require-user';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

const MODEL = openai('gpt-4o-mini');

function includeMessageInDiscussTranscript(row: {
  role: string;
  agent_type: string | null;
}): boolean {
  if (row.role === 'user') return true;
  if (row.role === 'system') return true;
  if (row.role !== 'assistant') return false;
  return row.agent_type === 'discussion';
}

function backlogSummaryLines(
  rows: Array<{ type: string; issue_key: string; title: string }>,
): string {
  const epic = rows.find((r) => r.type === 'epic');
  const stories = rows.filter((r) => r.type === 'story');
  const lines: string[] = [];
  if (epic) {
    lines.push(`Epic [${epic.issue_key}]: ${epic.title}`);
  }
  for (const s of stories) {
    lines.push(`- [${s.issue_key}] ${s.title}`);
  }
  return lines.length ? lines.join('\n') : '(No issues in database yet.)';
}

function clarificationsSnippet(inference_clarifications: unknown): string {
  if (!inference_clarifications || typeof inference_clarifications !== 'object') return '';
  const obj = inference_clarifications as Record<string, unknown>;
  if (isInferenceClarificationsV2(obj)) {
    const { questions, answers } = obj;
    if (questions.length === 0) return '';
    const lines = questions.map(
      (q: ClarifyingQuestion) => `- ${q.title}: ${formatAnswerForQuestion(q, answers[q.id])}`,
    );
    return ['Prior structured clarifications:', ...lines].join('\n');
  }
  return '';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;

  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const { data: feature, error: fe } = await sb
    .from('features')
    .select('id, name, purpose, requirements, inference_clarifications')
    .eq('id', featureId)
    .single();

  if (fe || !feature) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  }

  const { data: issueRows, error: ie } = await sb
    .from('feature_issues')
    .select('type, issue_key, title')
    .eq('feature_id', featureId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (ie) {
    return NextResponse.json({ error: ie.message }, { status: 500 });
  }

  const { data: rawMsgs, error: me } = await sb
    .from('feature_messages')
    .select('role, content, agent_type, sequence_num')
    .eq('feature_id', featureId)
    .order('sequence_num', { ascending: false })
    .limit(48);

  if (me) {
    return NextResponse.json({ error: me.message }, { status: 500 });
  }

  const chronological = (rawMsgs ?? []).reverse().filter(includeMessageInDiscussTranscript);
  const recent = chronological.slice(-24);
  const transcript =
    recent.length === 0
      ? '(No prior discussion thread.)'
      : recent
          .map((m) => {
            const who =
              m.role === 'user' ? 'User' : m.role === 'system' ? 'System' : 'Assistant';
            return `${who}: ${m.content}`;
          })
          .join('\n\n');

  const featureBlock = [
    `Feature: ${feature.name}`,
    feature.purpose ? `Purpose: ${feature.purpose}` : '',
    feature.requirements ? `Requirements: ${feature.requirements}` : '',
    clarificationsSnippet(feature.inference_clarifications),
  ]
    .filter(Boolean)
    .join('\n');

  const backlog = backlogSummaryLines((issueRows ?? []) as { type: string; issue_key: string; title: string }[]);

  const system = `You are a senior product manager helping the user reflect on the backlog for one feature.

Context:
- You have a compact list of saved epic/story titles and keys (not full descriptions).
- The user may have completed inference and competitor steps earlier; you do not have those full documents in this chat unless summarized in the transcript.
- Stay focused on prioritization, tradeoffs, risks, validation, and next steps — not rewriting the full spec.

Rules:
- Do NOT regenerate the full feature inference, competitor report, or issue list unless the user clearly asks you to.
- Prefer concise, actionable answers (short paragraphs or bullets).
- If you lack information, say what you would need to know.`;

  const prompt = `### Feature\n${featureBlock}\n\n### Saved backlog (titles)\n${backlog}\n\n### Recent discussion-only transcript\n${transcript}\n\n### New user message\n${message}`;

  try {
    const { text } = await generateText({
      model: MODEL,
      system,
      prompt,
      maxOutputTokens: 2048,
    });

    return NextResponse.json({ reply: text.trim() || '…' });
  } catch (e) {
    console.error('discuss', e);
    return NextResponse.json({ error: 'Discussion request failed' }, { status: 500 });
  }
}
