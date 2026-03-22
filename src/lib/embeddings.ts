import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import type { AppSupabase } from '@/lib/artifact-persistence';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

export async function computeEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: text,
  });
  return embedding;
}

export async function embedMessageAsync(
  sb: AppSupabase,
  messageId: string,
  content: string,
): Promise<void> {
  try {
    const vector = await computeEmbedding(content);
    const { data: row } = await sb
      .from('feature_messages')
      .select('metadata')
      .eq('id', messageId)
      .maybeSingle();

    const prevMeta =
      row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};

    await sb
      .from('feature_messages')
      .update({
        embedding: `[${vector.join(',')}]`,
        metadata: {
          ...prevMeta,
          embedding_model: EMBEDDING_MODEL,
          embedding_dims: EMBEDDING_DIMS,
        },
      })
      .eq('id', messageId);
  } catch (e) {
    console.error('[embeddings] Failed to embed message', messageId, e);
  }
}
