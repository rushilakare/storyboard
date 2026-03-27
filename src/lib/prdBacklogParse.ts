/**
 * Deterministic PRD → epic markdown + story drafts (no AI).
 * Aligned with PRD_OUTPUT_REQUIREMENTS in agent-prompts.ts.
 */

export const SPEQTR_STORIES_START = '<!-- speqtr:stories-start -->';
export const SPEQTR_STORIES_END = '<!-- speqtr:stories-end -->';

export interface ParsedStoryDraft {
  /** Display ref from PRD e.g. EP-01 */
  externalRef: string;
  title: string;
  persona: string;
  narrative: string;
  acceptanceCriteria: string[];
  notes: string;
}

export interface PrdBacklogParseResult {
  epicMarkdown: string;
  stories: ParsedStoryDraft[];
  warnings: string[];
}

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripMdBold(s: string): string {
  return s.replace(/\*\*/g, '').replace(/\*/g, '').trim();
}

/** Visible heading text without # prefix and leading numbering like "2." */
function headingBody(line: string): string | null {
  const m = line.match(/^#{1,6}\s+(.+)$/);
  if (!m) return null;
  return stripMdBold(m[1].replace(/^\d+\.\s+/, ''));
}

function isUserStoriesHeading(line: string): boolean {
  const body = headingBody(line);
  if (!body) return false;
  return /^user\s*stories$/i.test(body);
}

function findStoriesRegion(md: string): { epic: string; stories: string } | null {
  const text = normalizeNewlines(md);
  const startIdx = text.indexOf(SPEQTR_STORIES_START);
  if (startIdx !== -1) {
    const afterStart = startIdx + SPEQTR_STORIES_START.length;
    const endIdx = text.indexOf(SPEQTR_STORIES_END, afterStart);
    const stories =
      endIdx === -1 ? text.slice(afterStart).trim() : text.slice(afterStart, endIdx).trim();
    const epic = text.slice(0, startIdx).trim();
    return { epic, stories };
  }

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (isUserStoriesHeading(lines[i])) {
      const epic = lines.slice(0, i).join('\n').trim();
      const stories = lines.slice(i + 1).join('\n').trim();
      return { epic, stories };
    }
  }
  return null;
}

const LABEL_RE =
  /^\*{0,2}(Story ID|Title|Persona|Notes|User story narrative)\*{0,2}\s*:\s*(.*)$/i;

function parseStoryBlock(block: string): ParsedStoryDraft | null {
  const raw = block.trim();
  if (!raw) return null;

  let externalRef = '';
  let title = '';
  let persona = '';
  let narrative = '';
  const acceptanceCriteria: string[] = [];
  let notes = '';
  let mode: 'body' | 'ac' = 'body';

  const lines = raw.split('\n');

  const h3 = raw.match(/^###\s+(.+)$/m);
  if (h3) {
    const rest = stripMdBold(h3[1]);
    const idTitle =
      rest.match(/^([A-Za-z]{2,}-\d+)\s*[—–-]\s*(.+)$/) || rest.match(/^([A-Za-z]{2,}-\d+)\s+(.+)$/);
    if (idTitle) {
      externalRef = idTitle[1].toUpperCase();
      title = idTitle[2].trim();
    } else {
      title = rest;
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const low = stripMdBold(trimmed).toLowerCase();
    if (/^acceptance criteria/.test(low)) {
      mode = 'ac';
      continue;
    }
    if (/^user story narrative/.test(low) && trimmed.startsWith('#')) {
      mode = 'body';
      continue;
    }

    const lm = trimmed.match(LABEL_RE);
    if (lm) {
      mode = 'body';
      const k = lm[1].toLowerCase();
      const v = stripMdBold(lm[2].trim());
      if (k === 'story id') externalRef = v.toUpperCase() || externalRef;
      else if (k === 'title') title = v || title;
      else if (k === 'persona') persona = v;
      else if (k === 'notes') notes = v;
      else if (k === 'user story narrative') narrative = v;
      continue;
    }

    if (mode === 'ac') {
      const num = trimmed.replace(/^(\d+)[.)]\s+/, '').trim();
      if (num) acceptanceCriteria.push(num);
      continue;
    }

    if (/^as a\b/i.test(stripMdBold(trimmed))) {
      narrative = stripMdBold(trimmed);
    }
  }

  if (!title && externalRef) {
    title = `Story ${externalRef}`;
  }
  if (!title) {
    const first = stripMdBold(lines.find((l) => l.trim()) ?? '');
    if (first && !first.startsWith('#')) title = first.slice(0, 200);
  }
  if (!title) return null;

  if (!externalRef) {
    externalRef = `STORY-${title.slice(0, 24).replace(/\s+/g, '-').toUpperCase()}`;
  }

  return {
    externalRef,
    title,
    persona,
    narrative,
    acceptanceCriteria,
    notes,
  };
}

function splitStoryBlocks(storiesRegion: string): string[] {
  const text = storiesRegion.trim();
  if (!text) return [];

  const parts = text.split(/(?=^###\s+)/m);
  return parts.map((p) => p.trim()).filter((p) => /^###\s+/.test(p));
}

/**
 * Parse PRD markdown into epic body (pre–user-stories) and story drafts.
 */
export function prdBacklogParse(markdown: string): PrdBacklogParseResult {
  const warnings: string[] = [];
  const split = findStoriesRegion(markdown);
  if (!split) {
    return {
      epicMarkdown: normalizeNewlines(markdown).trim(),
      stories: [],
      warnings: [
        'Could not find a User stories section. Add a ## User stories heading or the <!-- speqtr:stories-start --> marker before stories.',
      ],
    };
  }

  const { epic, stories } = split;
  if (!epic) {
    warnings.push('Epic section before User stories is empty.');
  }

  const blocks = splitStoryBlocks(stories);
  const storiesOut: ParsedStoryDraft[] = [];
  const seenRefs = new Set<string>();

  for (const block of blocks) {
    const parsed = parseStoryBlock(block);
    if (!parsed) continue;
    if (seenRefs.has(parsed.externalRef)) {
      warnings.push(`Duplicate story ref "${parsed.externalRef}" — later block may need a unique ID.`);
    }
    seenRefs.add(parsed.externalRef);
    if (parsed.acceptanceCriteria.length === 0) {
      warnings.push(`Story "${parsed.title}" has no numbered acceptance criteria.`);
    }
    if (!parsed.narrative) {
      warnings.push(`Story "${parsed.title}" has no "As a …" narrative line detected.`);
    }
    storiesOut.push(parsed);
  }

  if (storiesOut.length === 0 && stories.trim().length > 0) {
    warnings.push(
      'User stories region is non-empty but no ### story blocks were parsed. Use ### headings per story.',
    );
  }

  return { epicMarkdown: epic, stories: storiesOut, warnings };
}
