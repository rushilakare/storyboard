export const KNOWLEDGE_BUCKET = 'knowledge';

/** Max pasted / extracted text length (UTF-16 chars, approximate bound). */
export const MAX_KNOWLEDGE_TEXT_CHARS = 120_000;

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const MAX_CHUNKS_PER_DOCUMENT = 150;

export const CHUNK_TARGET_CHARS = 3500;

export const CHUNK_OVERLAP_CHARS = 400;

export const EMBED_BATCH_SIZE = 8;

export const PDF_MAX_PAGES = 80;

export const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'avi',
  'mkv',
  'm4v',
  'mpeg',
  'mpg',
  'wmv',
]);

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}

export function isAllowedUploadMime(mime: string): boolean {
  if (!mime || isVideoMime(mime)) return false;
  if (ALLOWED_MIME.has(mime)) return true;
  if (mime.startsWith('text/')) return true;
  return false;
}

export function sanitizeStorageFilename(name: string): string {
  const base = name.replace(/[/\\]/g, '_').replace(/\s+/g, ' ').trim() || 'file';
  return base.slice(0, 200);
}
