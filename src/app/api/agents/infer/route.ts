import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { INFERENCE_CLARIFYING_JSON_RULES, INFERENCE_OUTPUT_DISCIPLINE } from '@/lib/agent-prompts';
import { MODEL_GPT_5_4, recordAiUsage } from '@/lib/ai/recordUsage';
import { requireUser } from '@/lib/auth/require-user';
import { assembleFeatureContext } from '@/lib/context';
import { knowledgeBaseHeaders } from '@/lib/knowledge/httpHeaders';

export const maxDuration = 60;

const INFER_MODEL = openai(MODEL_GPT_5_4);

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { featureId, name, purpose, requirements, revision } = body;

    if (featureId) {
      const context = await assembleFeatureContext(auth.supabase, featureId, 'inference', {
        userQuery: revision || undefined,
        enableRetrieval: !!revision,
        userId: auth.userId,
      });

      const { textStream } = streamText({
        model: INFER_MODEL,
        system: context.systemPrompt,
        messages: context.messages,
        onFinish: async ({ totalUsage }) => {
          await recordAiUsage(auth.supabase, {
            userId: auth.userId,
            featureId,
            source: 'infer',
            modelId: MODEL_GPT_5_4,
            usage: totalUsage,
          });
        },
      });

      return new Response(textStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...knowledgeBaseHeaders(context.knowledgeBase),
        },
      });
    }

    let prompt = `You are an expert product management assistant simulating an inference agent for a linear-inspired tool.
The user is requesting a new product feature with the following details:
Feature Name: ${name || "N/A"}
Core Problem to Solve: ${purpose || "Not specified"}
Key Capabilities: ${requirements || "None"}

${INFERENCE_OUTPUT_DISCIPLINE}

${INFERENCE_CLARIFYING_JSON_RULES}`;

    if (revision) {
      prompt += `\n\nThe user also provided additional feedback/revision: "${revision}". Please update your inference based on this.`;
    }

    const { textStream } = streamText({
      model: INFER_MODEL,
      prompt,
      onFinish: async ({ totalUsage }) => {
        await recordAiUsage(auth.supabase, {
          userId: auth.userId,
          featureId: null,
          source: 'infer',
          modelId: MODEL_GPT_5_4,
          usage: totalUsage,
        });
      },
    });

    return new Response(textStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to infer feature" }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
