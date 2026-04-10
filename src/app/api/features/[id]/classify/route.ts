import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/require-user';
import { MODEL_GPT_4O_MINI, recordAiUsage } from '@/lib/ai/recordUsage';

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

    const { object, usage } = await generateObject({
      model: CLASSIFY_MODEL,
      schema: ClassifySchema,
      prompt: `You are classifying a user message in a PM tool chat to determine if it is a natural language command to trigger an AI agent, or just a regular discussion message.

${stateContext}

Intents:
- "regenerate_inference": user explicitly wants to redo/regenerate the feature inference analysis (e.g. "regenerate the analysis", "redo the inference with this constraint: …")
- "generate_prd": user explicitly wants to create/generate the PRD document for the first time (only valid if inference exists but PRD does not)
- "regenerate_prd": user explicitly wants to rewrite/regenerate the entire PRD document (e.g. "rewrite the PRD to …", "regenerate the PRD", "make a new PRD") — only valid if PRD already exists
- "discussion": everything else

Examples that are ALWAYS "discussion":
- "share a summary", "summarize this", "give me a summary"
- "explain the tradeoffs", "what are the tradeoffs"
- "what did we decide", "what was decided"
- "what are the risks", "walk me through the PRD"
- "what do you think about X", "can you explain Y"
- "add X to the PRD", "include Y in the PRD" (vague edit requests — not full regens)
- "this needs more work", "I think we should redo this"
- any question about the feature, the PRD, or the analysis

Be conservative. Only classify as a command if the user's intent to trigger that specific agent is clear and direct.

User message: "${message.replace(/"/g, '\\"')}"

Classify this message:`,
    });

    await recordAiUsage(auth.supabase, {
      userId: auth.userId,
      source: 'classify',
      modelId: MODEL_GPT_4O_MINI,
      usage,
    });

    return Response.json(object);
  } catch {
    return Response.json({ intent: 'discussion' });
  }
}
