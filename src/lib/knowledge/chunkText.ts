import { CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS, MAX_CHUNKS_PER_DOCUMENT } from './constants';

export function chunkPlainText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let i = 0;
  const target = CHUNK_TARGET_CHARS;
  const overlap = CHUNK_OVERLAP_CHARS;

  while (i < normalized.length && chunks.length < MAX_CHUNKS_PER_DOCUMENT) {
    let end = Math.min(i + target, normalized.length);
    if (end < normalized.length) {
      const slice = normalized.slice(i, end);
      const breakAt = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '));
      if (breakAt > target * 0.35) {
        end = i + breakAt + 1;
      }
    }
    const piece = normalized.slice(i, end).trim();
    if (piece.length > 0) chunks.push(piece);
    if (end >= normalized.length) break;
    i = Math.max(end - overlap, i + 1);
  }

  return chunks;
}
