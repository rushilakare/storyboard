import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  ARTIFACT_KIND_COMPETITOR,
  ARTIFACT_KIND_INFERENCE,
  getLatestCompletedArtifactByKind,
} from '@/lib/artifact-persistence';
import { requireUser } from '@/lib/auth/require-user';
import { buildIssueGenerationPrompt } from '@/lib/issueGenerationPrompt';
import { formatEpicMarkdownForStorage, parseIssueGenerationJson } from '@/lib/issueGenerationSchema';
import {
  formatAnswerForQuestion,
  isInferenceClarificationsV2,
  type ClarifyingQuestion,
} from '@/lib/postInferenceQuestions';
import { NextResponse } from 'next/server';

const MODEL = openai('gpt-4o-mini');

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;

  const { data: feature, error: fe } = await sb
    .from('features')
    .select('id, name, purpose, requirements, inference_clarifications')
    .eq('id', featureId)
    .single();
  if (fe || !feature) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  }

  const inference = await getLatestCompletedArtifactByKind(sb, featureId, ARTIFACT_KIND_INFERENCE);
  const competitor = await getLatestCompletedArtifactByKind(sb, featureId, ARTIFACT_KIND_COMPETITOR);

  const inferenceBody = (inference?.body ?? '').trim();
  const competitorBody = (competitor?.body ?? '').trim();

  if (inferenceBody.length < 80 && competitorBody.length < 80) {
    return NextResponse.json(
      {
        error:
          'Need substantive feature inference and/or competitor analysis artifacts. Complete those agents first.',
      },
      { status: 400 },
    );
  }

  const clarLines: string[] = [];
  const clar = feature.inference_clarifications;
  if (clar && typeof clar === 'object') {
    const obj = clar as Record<string, unknown>;
    if (isInferenceClarificationsV2(obj)) {
      const { questions, answers } = obj;
      if (questions.length > 0) {
        clarLines.push('User clarifications (from pre-inference Q&A):');
        for (const q of questions as ClarifyingQuestion[]) {
          clarLines.push(`- ${q.title}: ${formatAnswerForQuestion(q, answers[q.id])}`);
        }
      }
    } else {
      const entries = Object.entries(obj).filter(([k]) => k !== 'v');
      if (entries.length > 0) {
        clarLines.push('User clarifications:');
        for (const [key, val] of entries) {
          if (val === null) continue;
          if (typeof val === 'string') clarLines.push(`- ${key}: ${val}`);
          else if (Array.isArray(val)) clarLines.push(`- ${key}: ${val.join(', ')}`);
          else if (typeof val === 'object' && val !== null && 'selected' in val) {
            const sel = val as { selected: string[]; other?: string };
            const parts = [...sel.selected];
            if (sel.other) parts.push(sel.other);
            clarLines.push(`- ${key}: ${parts.join(', ')}`);
          }
        }
      }
    }
  }

  const featureContext = [
    `Feature name: ${feature.name}`,
    feature.purpose ? `Purpose: ${feature.purpose}` : '',
    feature.requirements ? `Requirements notes: ${feature.requirements}` : '',
    ...clarLines,
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = buildIssueGenerationPrompt({
    featureContext,
    inferenceBody,
    competitorBody,
  });

  const { text } = await generateText({
    model: MODEL,
    prompt,
    maxOutputTokens: 8192,
  });

  const parsed = parseIssueGenerationJson(text);
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: parsed.error,
        rawExcerpt: text.slice(0, 2000),
      },
      { status: 422 },
    );
  }

  const { epic: epicData, stories: storyList } = parsed.data;
  const epicDescription = formatEpicMarkdownForStorage(epicData);

  return NextResponse.json({
    source: {
      inference: inference
        ? { version: inference.version, updatedAt: inference.updated_at }
        : null,
      competitor: competitor
        ? { version: competitor.version, updatedAt: competitor.updated_at }
        : null,
    },
    epic: {
      title: epicData.title,
      description: epicDescription,
      acceptance_criteria: epicData.acceptance_criteria,
      due_date: epicData.due_date,
    },
    stories: storyList.map((s) => ({
      externalRef: s.id,
      title: s.title,
      description: s.description,
      persona: s.persona,
      narrative: s.narrative,
      notes: [
        s.notes.trim(),
        s.dependencies.length ? `Dependencies: ${s.dependencies.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      acceptanceCriteria: s.acceptance_criteria,
      due_date: s.due_date,
      status: s.status,
      priority: s.priority,
      include: true,
    })),
  });
}
