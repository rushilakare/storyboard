import './pdfDomPolyfill';

import { MODEL_GPT_4O_MINI, type ProviderUsageTokens } from '@/lib/ai/recordUsage';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import mammoth from 'mammoth';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFParse } from 'pdf-parse';
import { PDF_MAX_PAGES } from './constants';

let pdfWorkerConfigured = false;

/** pdfjs worker path breaks when Next bundles deps; point at the real file on disk. */
function ensurePdfJsWorker(): void {
  if (pdfWorkerConfigured) return;
  pdfWorkerConfigured = true;
  try {
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    PDFParse.setWorker(pathToFileURL(workerPath).href);
  } catch {
    /* setWorker optional if resolve fails in odd deploy layouts */
  }
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  ensurePdfJsWorker();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText({ first: PDF_MAX_PAGES });
    return result.text?.trim() ?? '';
  } finally {
    await parser.destroy().catch(() => {});
  }
}

export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return (value ?? '').trim();
}

export async function extractTextFromImage(
  buffer: Buffer,
  mimeType: string,
): Promise<{ text: string; usage: ProviderUsageTokens | undefined }> {
  const { text, usage } = await generateText({
    model: openai(MODEL_GPT_4O_MINI),
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe all visible text in this image. If there is no text, give a concise factual description useful as product/domain context for a knowledge base. Plain text only, no markdown.',
          },
          { type: 'image', image: buffer, mediaType: mimeType },
        ],
      },
    ],
  });
  return { text: text.trim(), usage };
}

export type KnowledgeExtractResult = {
  text: string;
  /** Present when vision model was used for image uploads */
  vision?: { usage: ProviderUsageTokens | undefined; modelId: string };
};

export async function extractKnowledgeText(
  buffer: Buffer,
  mimeType: string,
): Promise<KnowledgeExtractResult> {
  if (mimeType === 'application/pdf') {
    return { text: await extractTextFromPdf(buffer) };
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword'
  ) {
    return { text: await extractTextFromDocx(buffer) };
  }
  if (mimeType.startsWith('image/')) {
    const { text, usage } = await extractTextFromImage(buffer, mimeType);
    return {
      text,
      vision: { usage, modelId: MODEL_GPT_4O_MINI },
    };
  }
  const asText = buffer.toString('utf8');
  return { text: asText.trim() };
}
