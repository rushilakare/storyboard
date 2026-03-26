import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
} from 'docx';

const HEADING_LEVELS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;

/**
 * Minimal markdown → docx: fenced code stripped, ATX headings, plain paragraphs.
 */
export function markdownToParagraphs(markdown: string): Paragraph[] {
  const stripped = markdown.replace(/```[\s\S]*?```/g, '\n');
  const lines = stripped.split(/\r?\n/);
  const out: Paragraph[] = [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;

    const hm = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (hm) {
      const depth = hm[1].length;
      const text = hm[2].trim();
      if (text) {
        const heading =
          HEADING_LEVELS[Math.min(depth, 6) - 1] ?? HeadingLevel.HEADING_1;
        out.push(new Paragraph({ text, heading }));
      }
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      out.push(new Paragraph({ text: `• ${bullet[1].trim()}` }));
      continue;
    }

    out.push(new Paragraph({ text: trimmed }));
  }

  if (out.length === 0) {
    out.push(new Paragraph({ text: '' }));
  }
  return out;
}

export async function markdownToDocxBuffer(markdown: string): Promise<Buffer> {
  const children = markdownToParagraphs(markdown);
  const doc = new Document({
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
