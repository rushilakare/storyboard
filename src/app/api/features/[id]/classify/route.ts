import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { MODEL_GPT_4O_MINI } from '@/lib/ai/recordUsage';

export const maxDuration = 15;

const CLASSIFY_MODEL = openai(MODEL_GPT_4O_MINI);

const ClassifySchema = z.object({
  intent: z.enum(['discussion', 'regenerate_inference', 'generate_prd', 'regenerate_prd']),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  // Verify the feature belongs to the user (implicit via RLS) — params used for routing only
  void params;

  try {
    const body = await request.json() as {
      message: string;
      featureState?: { hasInference: boolean; hasPrd: boolean };
    };
    const { message, featureState } = body;

    if (!message?.trim()) {
      return Response.json({ intent: 'discussion' });
    }

    const stateContext = featureState
      ? `Current feature state: inference ${featureState.hasInference ? 'exists' : 'not yet generated'}, PRD ${featureState.hasPrd ? 'exists' : 'not yet generated'}.`
      : '';

    const { object } = await generateObject({
      model: CLASSIFY_MODEL,
      schema: ClassifySchema,
      prompt: `You are classifying a user message in a PM tool chat to determine if it is a natural language command to trigger an AI agent, or just a regular discussion message.

${stateContext}

Intents:
- "regenerate_inference": user wants to redo/regenerate the feature inference analysis
- "generate_prd": user wants to create/generate the PRD document (only valid if inference exists)
- "regenerate_prd": user wants to redo/regenerate the PRD document (only valid if PRD exists)
- "discussion": everything else — questions, feedback, comments, revisions, unclear intent

Be conservative. Only classify as a command if the user's intent to trigger that specific agent is clear and direct. Ambiguous messages like "I think we should redo this" or "this needs more work" should be "discussion".

User message: "${message.replace(/"/g, '\\"')}"

Classify this message:`,
    });

    return Response.json(object);
  } catch {
    return Response.json({ intent: 'discussion' });
  }
}
