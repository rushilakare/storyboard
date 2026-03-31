import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { COMPETITOR_OUTPUT_DISCIPLINE } from '@/lib/agent-prompts';
import { MODEL_GPT_5_4, recordAiUsage } from '@/lib/ai/recordUsage';
import { requireUser } from '@/lib/auth/require-user';
import { assembleFeatureContext } from '@/lib/context';
import { knowledgeBaseHeaders } from '@/lib/knowledge/httpHeaders';

export const maxDuration = 60;

const COMPETITOR_MODEL = openai(MODEL_GPT_5_4);

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { featureId, name, purpose, requirements, revision } = body;

    if (featureId) {
      const context = await assembleFeatureContext(auth.supabase, featureId, 'competitor', {
        userQuery: revision || undefined,
        enableRetrieval: !!revision,
        userId: auth.userId,
      });

      const { textStream } = streamText({
        model: COMPETITOR_MODEL,
        system: context.systemPrompt,
        messages: context.messages,
        onFinish: async ({ totalUsage }) => {
          await recordAiUsage(auth.supabase, {
            userId: auth.userId,
            featureId,
            source: 'competitor',
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

    let prompt = `You are an expert product management assistant simulating a Competitor Research Agent.
The user's feature:
Feature Name: ${name || "N/A"}
Purpose: ${purpose || "Not specified"}
Requirements: ${requirements || "None"}

Simulate a quick industry / competitive scan (no live web access) for this domain.

${COMPETITOR_OUTPUT_DISCIPLINE}`;

    if (revision) {
      prompt += `\n\nUser revision: "${revision}". Please update your research accordingly.`;
    }

    const { textStream } = streamText({
      model: COMPETITOR_MODEL,
      prompt,
      onFinish: async ({ totalUsage }) => {
        await recordAiUsage(auth.supabase, {
          userId: auth.userId,
          featureId: null,
          source: 'competitor',
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
      JSON.stringify({ success: false, error: "Failed to search competitors" }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
