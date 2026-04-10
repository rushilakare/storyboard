import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export type AiUsageSource =
  | 'classify'
  | 'discuss'
  | 'infer'
  | 'infer_questions'
  | 'prd'
  | 'knowledge_ocr';

/** Provider usage shape from AI SDK `generateText` / `streamText` `onFinish` (`totalUsage`). */
export type ProviderUsageTokens = {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
};

export async function recordAiUsage(
  supabase: SupabaseClient<Database>,
  params: {
    userId: string;
    featureId?: string | null;
    source: AiUsageSource;
    modelId: string;
    usage: ProviderUsageTokens | undefined;
  },
): Promise<void> {
  const { usage } = params;
  const { error } = await supabase.from('ai_usage_events').insert({
    user_id: params.userId,
    feature_id: params.featureId ?? null,
    source: params.source,
    model_id: params.modelId,
    input_tokens: usage?.inputTokens ?? null,
    output_tokens: usage?.outputTokens ?? null,
    total_tokens: usage?.totalTokens ?? null,
  });
  if (error) {
    console.error('[recordAiUsage]', params.source, error.message);
  }
}

export const MODEL_GPT_5_4 = 'gpt-5.4-2026-03-05';
export const MODEL_GPT_4O_MINI = 'gpt-4o-mini';
