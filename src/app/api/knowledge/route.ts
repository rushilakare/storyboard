import { requireUser } from '@/lib/auth/require-user';
import type { AppSupabase } from '@/lib/artifact-persistence';
import {
  isAllowedUploadMime,
  isVideoMime,
  KNOWLEDGE_BUCKET,
  MAX_KNOWLEDGE_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  sanitizeStorageFilename,
  VIDEO_EXTENSIONS,
} from '@/lib/knowledge/constants';
import { extractKnowledgeText } from '@/lib/knowledge/extractText';
import { embedAndInsertChunks } from '@/lib/knowledge/persistChunks';
import { ilikeContainsPattern } from '@/lib/search/escapeIlike';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

function extFromName(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

async function markFailed(
  sb: AppSupabase,
  id: string,
  message: string,
  storagePath: string | null,
) {
  if (storagePath) {
    await sb.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
  }
  await sb
    .from('knowledge_documents')
    .update({ status: 'failed', error_message: message.slice(0, 2000) })
    .eq('id', id);
}

async function finalizeDocument(
  sb: AppSupabase,
  userId: string,
  documentId: string,
  plainText: string,
  storagePath: string | null,
) {
  const result = await embedAndInsertChunks(sb, userId, documentId, plainText);
  if ('error' in result) {
    await markFailed(sb, documentId, result.error, storagePath);
    return;
  }
  await sb
    .from('knowledge_documents')
    .update({
      status: 'ready',
      chunk_count: result.chunkCount,
      error_message: null,
    })
    .eq('id', documentId);
}

export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';

  let query = auth.supabase
    .from('knowledge_documents')
    .select(
      'id, source_kind, filename, title, mime_type, byte_size, status, chunk_count, error_message, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (q) {
    const p = ilikeContainsPattern(q);
    query = query.or(
      `filename.ilike.${p},title.ilike.${p},source_kind.ilike.${p},status.ilike.${p},mime_type.ilike.${p}`,
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const ct = request.headers.get('content-type') ?? '';

  if (ct.includes('application/json')) {
    return handleTextKnowledge(auth.supabase, auth.userId, request);
  }

  if (ct.includes('multipart/form-data')) {
    return handleFileUpload(auth.supabase, auth.userId, request);
  }

  return NextResponse.json({ error: 'Unsupported Content-Type' }, { status: 415 });
}

async function handleTextKnowledge(
  sb: AppSupabase,
  userId: string,
  request: Request,
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const obj = body as Record<string, unknown>;
  const sourceKind = obj.sourceKind;
  const content = typeof obj.content === 'string' ? obj.content : '';
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';

  if (sourceKind !== 'text') {
    return NextResponse.json({ error: 'sourceKind must be "text"' }, { status: 400 });
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  if (trimmed.length > MAX_KNOWLEDGE_TEXT_CHARS) {
    return NextResponse.json(
      { error: `content exceeds ${MAX_KNOWLEDGE_TEXT_CHARS} characters` },
      { status: 400 },
    );
  }

  const byteSize = Buffer.byteLength(trimmed, 'utf8');
  const filename = title ? `${sanitizeStorageFilename(title)}.txt` : 'Pasted note.txt';

  const { data: doc, error: insErr } = await sb
    .from('knowledge_documents')
    .insert({
      user_id: userId,
      source_kind: 'text',
      filename,
      title: title || null,
      mime_type: 'text/plain',
      byte_size: byteSize,
      storage_path: null,
      body: trimmed,
      status: 'processing',
    })
    .select('id')
    .single();

  if (insErr || !doc) {
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  const documentId = doc.id;
  await finalizeDocument(sb, userId, documentId, trimmed, null);

  const { data: row } = await sb
    .from('knowledge_documents')
    .select(
      'id, source_kind, filename, title, mime_type, byte_size, status, chunk_count, error_message, created_at',
    )
    .eq('id', documentId)
    .single();

  return NextResponse.json(row);
}

async function handleFileUpload(sb: AppSupabase, userId: string, request: Request) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 15 MB)' }, { status: 400 });
  }

  const ext = extFromName(file.name);
  if (VIDEO_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'Video files are not supported' }, { status: 400 });
  }

  let mime = file.type || 'application/octet-stream';
  if (mime === 'application/octet-stream' && ext === 'md') mime = 'text/markdown';
  if (mime === 'application/octet-stream' && ext === 'txt') mime = 'text/plain';
  if (mime === 'application/octet-stream' && ext === 'pdf') mime = 'application/pdf';
  if (mime === 'application/octet-stream' && ext === 'docx') {
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  if (isVideoMime(mime)) {
    return NextResponse.json({ error: 'Video files are not supported' }, { status: 400 });
  }

  if (!isAllowedUploadMime(mime)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = sanitizeStorageFilename(file.name);
  const documentId = crypto.randomUUID();
  const storagePath = `${userId}/${documentId}/${safeName}`;

  const { error: upErr } = await sb.storage.from(KNOWLEDGE_BUCKET).upload(storagePath, buffer, {
    contentType: mime,
    upsert: false,
  });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data: doc, error: insErr } = await sb
    .from('knowledge_documents')
    .insert({
      id: documentId,
      user_id: userId,
      source_kind: 'upload',
      filename: file.name,
      title: null,
      mime_type: mime,
      byte_size: file.size,
      storage_path: storagePath,
      body: null,
      status: 'processing',
    })
    .select('id')
    .single();

  if (insErr || !doc) {
    await sb.storage.from(KNOWLEDGE_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  let plain: string;
  try {
    plain = await extractKnowledgeText(buffer, mime);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Extraction failed';
    await markFailed(sb, documentId, msg, storagePath);
    const { data: row } = await sb
      .from('knowledge_documents')
      .select(
        'id, source_kind, filename, title, mime_type, byte_size, status, chunk_count, error_message, created_at',
      )
      .eq('id', documentId)
      .single();
    return NextResponse.json(row, { status: 201 });
  }

  if (!plain.trim()) {
    await markFailed(sb, documentId, 'No text could be extracted from this file', storagePath);
    const { data: row } = await sb
      .from('knowledge_documents')
      .select(
        'id, source_kind, filename, title, mime_type, byte_size, status, chunk_count, error_message, created_at',
      )
      .eq('id', documentId)
      .single();
    return NextResponse.json(row, { status: 201 });
  }

  if (plain.length > MAX_KNOWLEDGE_TEXT_CHARS) {
    plain = plain.slice(0, MAX_KNOWLEDGE_TEXT_CHARS);
  }

  await finalizeDocument(sb, userId, documentId, plain, storagePath);

  const { data: row } = await sb
    .from('knowledge_documents')
    .select(
      'id, source_kind, filename, title, mime_type, byte_size, status, chunk_count, error_message, created_at',
    )
    .eq('id', documentId)
    .single();

  return NextResponse.json(row, { status: 201 });
}
