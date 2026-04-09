import { streamText, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { INFERENCE_CLARIFYING_JSON_RULES, INFERENCE_OUTPUT_DISCIPLINE } from '@/lib/agent-prompts';
import { MODEL_GPT_5_4, MODEL_GPT_4O_MINI, recordAiUsage } from '@/lib/ai/recordUsage';
import { requireUser } from '@/lib/auth/require-user';
import { assembleFeatureContext } from '@/lib/context';
import { knowledgeBaseHeaders } from '@/lib/knowledge/httpHeaders';

export const maxDuration = 60;

const INFER_MODEL = openai(MODEL_GPT_5_4);
const TITLE_MODEL = openai(MODEL_GPT_4O_MINI);

async function generateInferenceTitle(name: string, purpose: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: TITLE_MODEL,
      prompt: `Generate a concise 4-8 word title for a feature inference artifact. Feature name: "${name}". Purpose: "${purpose}". Return only the title, no punctuation at the end, no quotes.`,
      maxOutputTokens: 30,
    });
    return text.trim();
  } catch {
    return '';
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { featureId, name, purpose, requirements, revision } = body;

    if (featureId) {
      const [context] = await Promise.all([
        assembleFeatureContext(auth.supabase, featureId, 'inference', {
          userQuery: revision || undefined,
          enableRetrieval: !!revision,
          userId: auth.userId,
        }),
      ]);

      // Fetch feature name/purpose for title generation
      const featureRes = await auth.supabase
        .from('features')
        .select('name, purpose')
        .eq('id', featureId)
        .single();
      const featureName = featureRes.data?.name ?? '';
      const featurePurpose = featureRes.data?.purpose ?? '';

      const [{ textStream }, artifactTitle] = await Promise.all([
        Promise.resolve(streamText({
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
        })),
        generateInferenceTitle(featureName, featurePurpose),
      ]);

      return new Response(textStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          ...(artifactTitle ? { 'X-Artifact-Title': artifactTitle } : {}),
          ...knowledgeBaseHeaders(context.knowledgeBase),
        },
      });
    }

    const featureName = name || 'N/A';
    const featurePurpose = purpose || 'Not specified';

    let prompt = `You are an expert product management assistant simulating an inference agent for a linear-inspired tool.
The user is requesting a new product feature with the following details:
Feature Name: ${featureName}
Core Problem to Solve: ${featurePurpose}
Key Capabilities: ${requirements || "None"}

${INFERENCE_OUTPUT_DISCIPLINE}

${INFERENCE_CLARIFYING_JSON_RULES}`;

    if (revision) {
      prompt += `\n\nThe user also provided additional feedback/revision: "${revision}". Please update your inference based on this.`;
    }

    const [{ textStream }, artifactTitle] = await Promise.all([
      Promise.resolve(streamText({
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
      })),
      generateInferenceTitle(featureName, featurePurpose),
    ]);

    return new Response(textStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(artifactTitle ? { 'X-Artifact-Title': artifactTitle } : {}),
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to infer feature" }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
