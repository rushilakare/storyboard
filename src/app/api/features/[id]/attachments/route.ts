import { requireUser } from '@/lib/auth/require-user';
import type { AppSupabase } from '@/lib/artifact-persistence';
import {
  isAllowedUploadMime,
  isVideoMime,
  FEATURES_BUCKET,
  MAX_KNOWLEDGE_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  sanitizeStorageFilename,
  VIDEO_EXTENSIONS,
} from '@/lib/knowledge/constants';
import { recordAiUsage, MODEL_GPT_4O_MINI } from '@/lib/ai/recordUsage';
import { extractKnowledgeText } from '@/lib/knowledge/extractText';
import { embedAndInsertAttachmentChunks } from '@/lib/knowledge/persistChunks';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

function extFromName(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

async function markFailed(
  sb: AppSupabase,
  attachmentId: string,
  message: string,
  storagePath: string | null,
) {
  if (storagePath) {
    await sb.storage.from(FEATURES_BUCKET).remove([storagePath]);
  }
  await sb
    .from('feature_attachments')
    .update({ status: 'failed', error_message: message.slice(0, 2000) })
    .eq('id', attachmentId);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const { supabase: sb, userId } = auth;

  // Verify feature ownership
  const { data: feature } = await sb
    .from('features')
    .select('id, workspace_id, workspaces!inner(created_by)')
    .eq('id', featureId)
    .single();

  if (!feature) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  }

  const ws = feature.workspaces as unknown as { created_by: string };
  if (ws.created_by !== userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 415 });
  }

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
  const attachmentId = crypto.randomUUID();
  const storagePath = `${userId}/${featureId}/${attachmentId}/${safeName}`;

  // Upload to storage
  const { error: upErr } = await sb.storage.from(FEATURES_BUCKET).upload(storagePath, buffer, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Insert row
  const { data: att, error: insErr } = await sb
    .from('feature_attachments')
    .insert({
      id: attachmentId,
      feature_id: featureId,
      user_id: userId,
      filename: file.name,
      mime_type: mime,
      byte_size: file.size,
      storage_path: storagePath,
      status: 'processing',
    })
    .select('*')
    .single();

  if (insErr || !att) {
    await sb.storage.from(FEATURES_BUCKET).remove([storagePath]);
    return NextResponse.json({ error: insErr?.message ?? 'Insert failed' }, { status: 500 });
  }

  // Extract text
  let plain: string;
  try {
    const extracted = await extractKnowledgeText(buffer, mime);
    if (extracted.vision) {
      await recordAiUsage(sb, {
        userId,
        featureId,
        source: 'knowledge_ocr',
        modelId: extracted.vision.modelId,
        usage: extracted.vision.usage,
      });
    }
    plain = extracted.text;
  } catch (e) {
    // For images, extraction failure is OK — mark ready so vision model can read it
    if (mime.startsWith('image/')) {
      await sb
        .from('feature_attachments')
        .update({ status: 'ready', extracted_text: null, summary: null, chunk_count: 0, error_message: null })
        .eq('id', attachmentId);
      const { data: row } = await sb.from('feature_attachments').select('*').eq('id', attachmentId).single();
      return NextResponse.json(row, { status: 201 });
    }
    const msg = e instanceof Error ? e.message : 'Extraction failed';
    await markFailed(sb, attachmentId, msg, storagePath);
    const { data: row } = await sb.from('feature_attachments').select('*').eq('id', attachmentId).single();
    return NextResponse.json(row, { status: 201 });
  }

  if (!plain.trim()) {
    // For images, mark as ready even without extracted text — the vision model
    // can read the image directly via a signed storage URL.
    if (mime.startsWith('image/')) {
      await sb
        .from('feature_attachments')
        .update({ status: 'ready', extracted_text: null, summary: null, chunk_count: 0, error_message: null })
        .eq('id', attachmentId);
      const { data: row } = await sb.from('feature_attachments').select('*').eq('id', attachmentId).single();
      return NextResponse.json(row, { status: 201 });
    }
    await markFailed(sb, attachmentId, 'No text could be extracted from this file', storagePath);
    const { data: row } = await sb.from('feature_attachments').select('*').eq('id', attachmentId).single();
    return NextResponse.json(row, { status: 201 });
  }

  if (plain.length > MAX_KNOWLEDGE_TEXT_CHARS) {
    plain = plain.slice(0, MAX_KNOWLEDGE_TEXT_CHARS);
  }

  // Generate LLM summary (~200 words)
  let summary: string | null = null;
  try {
    const summaryInput = plain.slice(0, 8000);
    const { text, usage } = await generateText({
      model: openai(MODEL_GPT_4O_MINI),
      system:
        'You are a product assistant. Summarize the key points from the following document in 150–200 words, focusing on product requirements, user flows, and technical constraints.',
      prompt: summaryInput,
    });
    summary = text.trim() || null;
    await recordAiUsage(sb, {
      userId,
      featureId,
      source: 'knowledge_ocr',
      modelId: MODEL_GPT_4O_MINI,
      usage,
    });
  } catch {
    // Summary failure is non-blocking
  }

  // Embed and insert chunks
  const chunkResult = await embedAndInsertAttachmentChunks(sb, userId, attachmentId, featureId, plain);
  if ('error' in chunkResult) {
    await markFailed(sb, attachmentId, chunkResult.error, storagePath);
    const { data: row } = await sb.from('feature_attachments').select('*').eq('id', attachmentId).single();
    return NextResponse.json(row, { status: 201 });
  }

  // Finalize
  await sb
    .from('feature_attachments')
    .update({
      status: 'ready',
      extracted_text: plain,
      summary,
      chunk_count: chunkResult.chunkCount,
      error_message: null,
    })
    .eq('id', attachmentId);

  const { data: row } = await sb.from('feature_attachments').select('*').eq('id', attachmentId).single();
  return NextResponse.json(row, { status: 201 });
}
