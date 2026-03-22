import {
  KNOWLEDGE_BASE_RESPONSE_HEADER,
  type KnowledgeBaseNotice,
} from './httpHeaders';

export type { KnowledgeBaseNotice };

export function parseKnowledgeBaseFromHeaders(headers: Headers): KnowledgeBaseNotice | null {
  const raw = headers.get(KNOWLEDGE_BASE_RESPONSE_HEADER);
  if (!raw) return null;
  try {
    const o = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!o || typeof o !== 'object') return null;
    const rec = o as Record<string, unknown>;
    if (typeof rec.consulted !== 'boolean' || !Array.isArray(rec.sources)) return null;
    if (!rec.sources.every((s) => typeof s === 'string')) return null;
    return { consulted: rec.consulted, sources: rec.sources as string[] };
  } catch {
    return null;
  }
}

/** User-visible chat line(s); null = nothing to show (e.g. library not queried). */
export function formatKnowledgeBaseChatNote(kb: KnowledgeBaseNotice): string | null {
  if (kb.sources.length > 0) {
    const lines = [
      'Knowledge base: this reply uses retrieved excerpts from your library.',
      'Sources:',
      ...kb.sources.map((s) => `  • ${s}`),
    ];
    return lines.join('\n');
  }
  if (kb.consulted) {
    return 'Knowledge base: your library was searched, but no excerpts met the relevance threshold for this reply.';
  }
  return null;
}
