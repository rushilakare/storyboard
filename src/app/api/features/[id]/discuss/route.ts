import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { FEATURES_BUCKET } from '@/lib/knowledge/constants';
import {
  ARTIFACT_KIND_INFERENCE,
  getLatestCompletedArtifactByKind,
} from '@/lib/artifact-persistence';
import {
  DISCUSS_ARTIFACT_MAX_CHARS,
  DISCUSS_TRANSCRIPT_MAX_CHARS,
  DISCUSS_TRANSCRIPT_PER_MESSAGE_MAX,
  type DiscussMessageRow,
  buildDiscussTranscriptFromMessages,
  formatArtifactBlock,
} from '@/lib/discuss-context';
import {
  formatAnswerForQuestion,
  isInferenceClarificationsV2,
  type ClarifyingQuestion,
} from '@/lib/postInferenceQuestions';
import { requireUser } from '@/lib/auth/require-user';
import { MODEL_GPT_4O_MINI, recordAiUsage } from '@/lib/ai/recordUsage';
import { computeEmbedding } from '@/lib/embeddings';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

const MODEL = openai(MODEL_GPT_4O_MINI);

const FEATURE_MESSAGES_FETCH_LIMIT = 120;

function clarificationsSnippet(inference_clarifications: unknown): string {
  if (!inference_clarifications || typeof inference_clarifications !== 'object') return '';
  const obj = inference_clarifications as Record<string, unknown>;
  if (isInferenceClarificationsV2(obj)) {
    const { questions, answers } = obj;
    if (questions.length === 0) return '';
    const lines = questions.map(
      (q: ClarifyingQuestion) => `- ${q.title}: ${formatAnswerForQuestion(q, answers[q.id])}`,
    );
    return ['Prior structured clarifications:', ...lines].join('\n');
  }
  return '';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id: featureId } = await params;
  const sb = auth.supabase;

  let body: { message?: string; attachmentIds?: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  const { data: feature, error: fe } = await sb
    .from('features')
    .select('id, name, purpose, requirements, inference_clarifications')
    .eq('id', featureId)
    .single();

  if (fe || !feature) {
    return NextResponse.json({ error: 'Feature not found' }, { status: 404 });
  }

  const inferenceArtifact = await getLatestCompletedArtifactByKind(sb, featureId, ARTIFACT_KIND_INFERENCE);

  const { data: rawMsgs, error: me } = await sb
    .from('feature_messages')
    .select('role, content, agent_type, sequence_num')
    .eq('feature_id', featureId)
    .order('sequence_num', { ascending: false })
    .limit(FEATURE_MESSAGES_FETCH_LIMIT);

  if (me) {
    return NextResponse.json({ error: me.message }, { status: 500 });
  }

  const chronological = (rawMsgs ?? []).reverse() as DiscussMessageRow[];
  const transcript = buildDiscussTranscriptFromMessages(
    chronological,
    DISCUSS_TRANSCRIPT_MAX_CHARS,
    DISCUSS_TRANSCRIPT_PER_MESSAGE_MAX,
  );

  // ── Attachment context ────────────────────────────────────────────────────
  // When attachmentIds are provided, scope ALL context (images, summaries,
  // chunks) to only those attachments. This prevents old files from bleeding
  // into the current message's AI context.
  let attachmentSection = '';
  const imageSignedUrls: Array<{ filename: string; url: string }> = [];
  const currentAttachmentIds = new Set(Array.isArray(body.attachmentIds) ? body.attachmentIds : []);
  const hasScope = currentAttachmentIds.size > 0;

  try {
    let query = sb
      .from('feature_attachments')
      .select('id, filename, mime_type, summary, storage_path')
      .eq('feature_id', featureId)
      .eq('status', 'ready');

    // When IDs are provided, only fetch those specific attachments
    if (hasScope) {
      query = query.in('id', Array.from(currentAttachmentIds));
    }

    const { data: attachments } = await query;

    if (attachments && attachments.length > 0) {
      // Generate signed URLs for image attachments
      for (const att of attachments) {
        if (att.mime_type?.startsWith('image/') && att.storage_path) {
          try {
            const { data: signed } = await sb.storage
              .from(FEATURES_BUCKET)
              .createSignedUrl(att.storage_path, 300);
            if (signed?.signedUrl) {
              imageSignedUrls.push({ filename: att.filename, url: signed.signedUrl });
            }
          } catch { /* skip this image */ }
        }
      }

      // Semantic chunk retrieval — scoped to current attachments when IDs provided
      let chunkLines: string[] = [];
      try {
        const embedding = await computeEmbedding(message);
        const { data: chunks } = await sb.rpc('match_feature_attachment_chunks', {
          p_feature_id: featureId,
          p_query_embedding: `[${embedding.join(',')}]`,
          p_match_count: 6,
        });
        // Filter chunks to current attachments when scoped
        const scopedAttIds = new Set(attachments.map((a) => a.id));
        const filtered = ((chunks ?? []) as Array<{ attachment_id?: string; filename: string; content: string }>)
          .filter((c) => !hasScope || !c.attachment_id || scopedAttIds.has(c.attachment_id));
        chunkLines = filtered.map((c) => `- [${c.filename}] ${c.content.slice(0, 400)}`);
      } catch { /* proceed without chunk retrieval */ }

      const summaryLines = attachments
        .filter((a) => a.summary)
        .map((a) => `**${a.filename}** (${a.mime_type})\n${a.summary}`);

      const parts: string[] = [];
      if (summaryLines.length > 0)
        parts.push('### Uploaded reference files (summaries)\n' + summaryLines.join('\n\n'));
      if (chunkLines.length > 0)
        parts.push('### Relevant excerpts from attachments\n' + chunkLines.join('\n'));
      if (parts.length > 0) attachmentSection = parts.join('\n\n');
    }
  } catch { /* proceed without attachment context */ }
  // ── End attachment context ─────────────────────────────────────────────────

  const featureBlock = [
    `Feature: ${feature.name}`,
    feature.purpose ? `Purpose: ${feature.purpose}` : '',
    feature.requirements ? `Requirements: ${feature.requirements}` : '',
    clarificationsSnippet(feature.inference_clarifications),
  ]
    .filter(Boolean)
    .join('\n');

  const inferenceBlock = formatArtifactBlock(
    '### Latest feature inference (saved artifact)',
    inferenceArtifact?.body,
    DISCUSS_ARTIFACT_MAX_CHARS,
  );
  const system = `You are a senior product manager helping the user work through one feature: research, PRD work, and workshop chat.

You are given (when available):
- Feature metadata and structured clarifications from earlier Q&A.
- The latest saved **feature inference** artifact (may be an excerpt if very long).
- A **recent transcript** of the feature thread (user, system, and assistant messages from inference, PRD, discussion, etc.), newest-heavy within a size limit.
- Any **uploaded reference files** (summaries and relevant excerpts) the user has attached during this session.

Use this context to answer questions about what was generated, what the team decided, tradeoffs, risks, and next steps. When the user uploads an image or screenshot, examine it carefully and describe or analyze its contents as requested. When the user asks about an uploaded file, use its summary, excerpts, and any attached images to answer directly. If something is missing or was truncated, say so briefly.

Rules:
- Do NOT rewrite or regenerate the full inference document or entire PRD unless the user clearly asks you to.
- Prefer concise, actionable answers (short paragraphs or bullets).
- If you truly lack information, say what you would need to know.`;

  const promptText = [
    '### Feature',
    featureBlock,
    '',
    inferenceBlock,
    '',
    attachmentSection,
    '',
    '### Recent feature thread (chronological excerpts, newest preserved first)',
    transcript,
    '',
    '### New user message',
    message,
  ].filter(Boolean).join('\n');

  // Build streamText args — use messages format only when images are present,
  // otherwise use the simpler prompt format to avoid any behavioral differences.
  const hasImages = imageSignedUrls.length > 0;

  const streamArgs = hasImages
    ? {
        model: MODEL,
        system,
        messages: [{
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: promptText },
            ...imageSignedUrls.map((img) => ({
              type: 'image' as const,
              image: new URL(img.url),
            })),
          ],
        }],
      }
    : {
        model: MODEL,
        system,
        prompt: promptText,
      };

  const result = streamText({
    ...streamArgs,
    maxOutputTokens: 2048,
    onFinish: async ({ usage }) => {
      await recordAiUsage(sb, {
        userId: auth.userId,
        featureId,
        source: 'discuss',
        modelId: MODEL_GPT_4O_MINI,
        usage,
      });
    },
  });

  return result.toTextStreamResponse();
}
