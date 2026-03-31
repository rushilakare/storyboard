import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  ARTIFACT_KIND_COMPETITOR,
  ARTIFACT_KIND_INFERENCE,
  getLatestCompletedArtifactByKind,
} from '@/lib/artifact-persistence';
import {
  DISCUSS_ARTIFACT_MAX_CHARS,
  DISCUSS_TRANSCRIPT_MAX_CHARS,
  DISCUSS_TRANSCRIPT_PER_MESSAGE_MAX,
  type DiscussMessageRow,
  buildDiscussTranscriptFromMessages,
  formatArtifactBlock,
} from '@/lib/discuss-context';
import {
  formatAnswerForQuestion,
  isInferenceClarificationsV2,
  type ClarifyingQuestion,
} from '@/lib/postInferenceQuestions';
import { requireUser } from '@/lib/auth/require-user';
import { MODEL_GPT_4O_MINI, recordAiUsage } from '@/lib/ai/recordUsage';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

const MODEL = openai(MODEL_GPT_4O_MINI);

const FEATURE_MESSAGES_FETCH_LIMIT = 120;

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

  const [inferenceArtifact, competitorArtifact] = await Promise.all([
    getLatestCompletedArtifactByKind(sb, featureId, ARTIFACT_KIND_INFERENCE),
    getLatestCompletedArtifactByKind(sb, featureId, ARTIFACT_KIND_COMPETITOR),
  ]);

  const { data: rawMsgs, error: me } = await sb
    .from('feature_messages')
    .select('role, content, agent_type, sequence_num')
    .eq('feature_id', featureId)
    .order('sequence_num', { ascending: false })
    .limit(FEATURE_MESSAGES_FETCH_LIMIT);

  if (me) {
    return NextResponse.json({ error: me.message }, { status: 500 });
  }

  const chronological = (rawMsgs ?? []).reverse() as DiscussMessageRow[];
  const transcript = buildDiscussTranscriptFromMessages(
    chronological,
    DISCUSS_TRANSCRIPT_MAX_CHARS,
    DISCUSS_TRANSCRIPT_PER_MESSAGE_MAX,
  );

  const featureBlock = [
    `Feature: ${feature.name}`,
    feature.purpose ? `Purpose: ${feature.purpose}` : '',
    feature.requirements ? `Requirements: ${feature.requirements}` : '',
    clarificationsSnippet(feature.inference_clarifications),
  ]
    .filter(Boolean)
    .join('\n');

  const inferenceBlock = formatArtifactBlock(
    '### Latest feature inference (saved artifact)',
    inferenceArtifact?.body,
    DISCUSS_ARTIFACT_MAX_CHARS,
  );
  const competitorBlock = formatArtifactBlock(
    '### Latest competitor analysis (saved artifact)',
    competitorArtifact?.body,
    DISCUSS_ARTIFACT_MAX_CHARS,
  );

  const system = `You are a senior product manager helping the user work through one feature: research, PRD work, and workshop chat.

You are given (when available):
- Feature metadata and structured clarifications from earlier Q&A.
- The latest saved **feature inference** and **competitor analysis** artifacts (may be excerpts if very long).
- A **recent transcript** of the feature thread (user, system, and assistant messages from inference, competitor, PRD, discussion, etc.), newest-heavy within a size limit.

Use this context to answer questions about what was generated, what the team decided, tradeoffs, risks, and next steps. If something is missing or was truncated, say so briefly.

Rules:
- Do NOT rewrite or regenerate the full inference document, competitor report, or entire PRD unless the user clearly asks you to.
- Prefer concise, actionable answers (short paragraphs or bullets).
- If you truly lack information, say what you would need to know.`;

  const prompt = [
    '### Feature',
    featureBlock,
    '',
    inferenceBlock,
    '',
    competitorBlock,
    '',
    '### Recent feature thread (chronological excerpts, newest preserved first)',
    transcript,
    '',
    '### New user message',
    message,
  ].join('\n');

  try {
    const { text, usage } = await generateText({
      model: MODEL,
      system,
      prompt,
      maxOutputTokens: 2048,
    });

    await recordAiUsage(sb, {
      userId: auth.userId,
      featureId,
      source: 'discuss',
      modelId: MODEL_GPT_4O_MINI,
      usage,
    });

    return NextResponse.json({ reply: text.trim() || '…' });
  } catch (e) {
    console.error('discuss', e);
    return NextResponse.json({ error: 'Discussion request failed' }, { status: 500 });
  }
}
