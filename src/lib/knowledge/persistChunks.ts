import type { AppSupabase } from '@/lib/artifact-persistence';
import { computeEmbedding } from '@/lib/embeddings';
import { EMBED_BATCH_SIZE } from './constants';
import { chunkPlainText } from './chunkText';

export async function embedAndInsertChunks(
  sb: AppSupabase,
  userId: string,
  documentId: string,
  fullText: string,
): Promise<{ chunkCount: number } | { error: string }> {
  const chunks = chunkPlainText(fullText);
  if (chunks.length === 0) {
    return { error: 'No extractable text to index' };
  }

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await Promise.all(batch.map((c) => computeEmbedding(c)));
    const rows = batch.map((content, j) => ({
      document_id: documentId,
      user_id: userId,
      chunk_index: i + j,
      content,
      embedding: `[${vectors[j].join(',')}]` as unknown as string,
    }));

    const { error } = await sb.from('knowledge_chunks').insert(rows);
    if (error) {
      console.error('[knowledge] chunk insert failed', error);
      await sb.from('knowledge_chunks').delete().eq('document_id', documentId);
      return { error: error.message };
    }
  }

  return { chunkCount: chunks.length };
}
