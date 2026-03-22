import type { AppSupabase } from '@/lib/artifact-persistence';
import { computeEmbedding } from '@/lib/embeddings';

export type KnowledgeRetrievedChunk = {
  id: string;
  document_id: string;
  source_label: string;
  content: string;
  similarity: number;
};

export async function retrieveKnowledgeChunks(
  sb: AppSupabase,
  queryText: string,
  topK = 8,
): Promise<KnowledgeRetrievedChunk[]> {
  const trimmed = queryText.trim();
  if (trimmed.length < 8) return [];

  const queryEmbedding = await computeEmbedding(trimmed);
  const { data, error } = await sb.rpc('match_knowledge_chunks', {
    p_query_embedding: `[${queryEmbedding.join(',')}]`,
    p_match_count: topK,
  });

  if (error) {
    console.error('[knowledge] match_knowledge_chunks failed', error);
    return [];
  }

  return (data ?? []) as KnowledgeRetrievedChunk[];
}
