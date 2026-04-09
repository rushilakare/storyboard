import { streamText, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  PRD_OUTPUT_REQUIREMENTS,
  PRD_PRODUCT_CONTEXT,
  PRD_ROLE_INTRO,
} from '@/lib/agent-prompts';
import { finalizeOpenPrdDraft } from '@/lib/artifact-persistence';
import { requireUser } from '@/lib/auth/require-user';
import { assembleFeatureContext } from '@/lib/context';
import { knowledgeBaseHeaders } from '@/lib/knowledge/httpHeaders';
import { patchFeatureStatus } from '@/lib/prd-persistence';
import { MODEL_GPT_5_4, MODEL_GPT_4O_MINI, recordAiUsage } from '@/lib/ai/recordUsage';

export const maxDuration = 60;

const PRD_MODEL = openai(MODEL_GPT_5_4);
const TITLE_MODEL = openai(MODEL_GPT_4O_MINI);

async function generatePrdTitle(name: string, purpose: string): Promise<string> {
  try {
    const { text } = await generateText({
      model: TITLE_MODEL,
      prompt: `Generate a concise 4-8 word title for a PRD artifact. Feature name: "${name}". Purpose: "${purpose}". Return only the title, no punctuation at the end, no quotes.`,
      maxOutputTokens: 30,
    });
    return text.trim();
  } catch {
    return '';
  }
}

const CONTINUATION_INSTRUCTION = `
### Interrupted draft (continue mode)
The following PRD was partially generated before being interrupted. Continue writing from exactly where it left off.
Do NOT repeat any paragraphs or sections already present. Pick up seamlessly after the last character of the partial draft.

--- PARTIAL DRAFT START ---
`;

const CONTINUATION_SUFFIX = `
--- PARTIAL DRAFT END ---
`;

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const sb = auth.supabase;

  try {
    const body = await request.json();
    const { featureId, name, purpose, requirements, revision, continue: continueDraft } = body as {
      featureId?: string;
      name?: string;
      purpose?: string;
      requirements?: string;
      revision?: string;
      continue?: string;
    };

    const continuationPrefix =
      typeof continueDraft === 'string' && continueDraft.length > 0 ? continueDraft : '';

    if (featureId) {
      const featureRes = await sb
        .from('features')
        .select('name, purpose')
        .eq('id', featureId)
        .single();
      const featureName = featureRes.data?.name ?? '';
      const featurePurpose = featureRes.data?.purpose ?? '';

      const [context, artifactTitle] = await Promise.all([
        assembleFeatureContext(sb, featureId, 'prd', {
          userQuery: revision || undefined,
          enableRetrieval: !!revision,
          omitSavedPrdDocument: continuationPrefix.length > 0,
          userId: auth.userId,
        }),
        generatePrdTitle(featureName, featurePurpose),
      ]);

      let systemPrompt = context.systemPrompt;
      if (continuationPrefix) {
        systemPrompt = [
          context.systemPrompt,
          '',
          CONTINUATION_INSTRUCTION,
          continuationPrefix,
          CONTINUATION_SUFFIX,
        ].join('\n');
      }

      const { textStream } = streamText({
        model: PRD_MODEL,
        system: systemPrompt,
        messages: context.messages,
        onFinish: async ({ text, totalUsage }) => {
          await recordAiUsage(sb, {
            userId: auth.userId,
            featureId,
            source: 'prd',
            modelId: MODEL_GPT_5_4,
            usage: totalUsage,
          });
          try {
            const merged =
              continuationPrefix.length > 0 ? `${continuationPrefix}${text}` : text;
            if (merged.length > 0) {
              const saved = await finalizeOpenPrdDraft(sb, featureId, merged);
              if (saved.ok) {
                await patchFeatureStatus(sb, featureId, 'done');
              } else {
                console.error('[prd agent] onFinish finalize failed', saved.error);
              }
            }
          } catch (e) {
            console.error('[prd agent] onFinish error', e);
          }
        },
      });

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

    let prompt = `${PRD_ROLE_INTRO} I need you to write a comprehensive PRD/Epic and then break it down into detailed user stories in Markdown format.

### The Requirement
Feature Name: ${featureName}
Core Problem to Solve: ${featurePurpose}
Key Capabilities/Requirements: ${requirements || 'None'}

${revision ? `### Additional Context/Revision\nThe user provided this update/feedback: "${revision}"` : ''}

${PRD_PRODUCT_CONTEXT}

${PRD_OUTPUT_REQUIREMENTS}`;

    if (continuationPrefix) {
      prompt = [
        prompt,
        '',
        CONTINUATION_INSTRUCTION,
        continuationPrefix,
        CONTINUATION_SUFFIX,
      ].join('\n');
    }

    const [{ textStream }, artifactTitle] = await Promise.all([
      Promise.resolve(streamText({
        model: PRD_MODEL,
        prompt,
        onFinish: async ({ totalUsage }) => {
          await recordAiUsage(sb, {
            userId: auth.userId,
            featureId: null,
            source: 'prd',
            modelId: MODEL_GPT_5_4,
            usage: totalUsage,
          });
        },
      })),
      generatePrdTitle(featureName, featurePurpose),
    ]);

    return new Response(textStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        ...(artifactTitle ? { 'X-Artifact-Title': artifactTitle } : {}),
      },
    });
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to generate PRD' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
