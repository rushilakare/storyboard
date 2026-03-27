import { generateText, Output } from 'ai';
import { openai } from '@ai-sdk/openai';
import { requireUser } from '@/lib/auth/require-user';
import { inferQuestionsResponseSchema } from '@/lib/inferQuestionsSchema';

export const maxDuration = 60;

/** gpt-4o-mini: reliable structured output; gpt-5.4 id can throw AI_APICallError if unavailable on the account. */
const MODEL = openai('gpt-4o-mini');

const SYSTEM = `You are a product manager assistant. Given only a short feature brief, produce clarifying questions that will improve the quality of a later feature-inference draft.

Rules:
- Output ONLY structured data matching the schema — no Markdown, no preamble, no feature inference.
- Produce 3–8 questions tailored to THIS specific feature (not generic templates).
- "id" for each question: short snake_case, unique in the set.
- "title": the exact question shown to the user.
- "type": one of single | multiple | multiple_with_other | text
- "options": for "text" use an empty array []. For all other types, include at least one { "id", "label" } option.

Type selection:
- single: exactly one answer (priority, persona, deployment model)
- multiple: several may apply (user groups, platforms)
- multiple_with_other: list may be incomplete
- text: open-ended unknowns

Mix types across questions.`;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const raw = body as {
      featureId?: string | null;
      name?: string;
      purpose?: string;
      requirements?: string;
    };

    let name = (raw.name ?? '').trim();
    let purpose = (raw.purpose ?? '').trim();
    let requirements = (raw.requirements ?? '').trim();

    const featureId =
      typeof raw.featureId === 'string' && raw.featureId.length > 0 ? raw.featureId : null;

    if (featureId) {
      const { data: row } = await auth.supabase
        .from('features')
        .select('name, purpose, requirements')
        .eq('id', featureId)
        .maybeSingle();

      if (row) {
        if (!name) name = (row.name ?? '').trim();
        if (!purpose) purpose = (row.purpose ?? '').trim();
        if (!requirements) requirements = (row.requirements ?? '').trim();
      }
    }

    const brief = [
      name ? `Feature name: ${name}` : '',
      purpose ? `Core problem / purpose: ${purpose}` : '',
      requirements ? `Requirements / capabilities: ${requirements}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (brief.trim().length < 8) {
      return Response.json(
        { error: 'Need at least a feature name or purpose to generate questions' },
        { status: 400 },
      );
    }

    const { output } = await generateText({
      model: MODEL,
      output: Output.object({
        schema: inferQuestionsResponseSchema,
        name: 'clarifying_questions',
        description: 'Structured clarifying questions for the feature brief',
      }),
      system: SYSTEM,
      prompt: `Feature brief:\n${brief}\n\nReturn clarifying questions only.`,
    });

    if (!output) {
      return Response.json({ error: 'Model returned no structured output' }, { status: 422 });
    }

    return Response.json(output);
  } catch (error) {
    console.error('infer-questions', error);
    const err = error as Error & { statusCode?: number };
    const safeMsg =
      typeof err.message === 'string' ? err.message.slice(0, 160).replace(/\s+/g, ' ') : '';
    return Response.json(
      {
        success: false,
        error: 'Failed to generate questions',
        ...(process.env.NODE_ENV === 'development' && safeMsg ? { detail: safeMsg } : {}),
      },
      { status: 500 },
    );
  }
}
