/** Newline + marker line + newline before the minified JSON line. */
export const CLARIFYING_QUESTIONS_DELIMITER = '\n\n<<<CLARIFYING_QUESTIONS_JSON>>>\n';

export type QuestionType = 'single' | 'multiple' | 'multiple_with_other' | 'text';

export interface QuestionOption {
  id: string;
  label: string;
}

export interface ClarifyingQuestion {
  id: string;
  title: string;
  type: QuestionType;
  options: QuestionOption[];
}

export type ClarificationAnswer =
  | string
  | string[]
  | { selected: string[]; other?: string }
  | null;

export type ClarificationAnswers = Record<string, ClarificationAnswer>;

const MARKER = '<<<CLARIFYING_QUESTIONS_JSON>>>';

export function splitInferenceDisplayBuffer(buffer: string): { display: string; jsonSlice: string | null } {
  const idx = buffer.indexOf(MARKER);
  if (idx === -1) {
    return { display: buffer, jsonSlice: null };
  }
  const afterMarker = buffer.slice(idx + MARKER.length);
  const display = buffer.slice(0, idx).replace(/\s+$/, '');
  const trimmedAfter = afterMarker.replace(/^\s*\n?/, '');
  return { display, jsonSlice: trimmedAfter.length > 0 ? trimmedAfter : null };
}

function isQuestionType(t: string): t is QuestionType {
  return t === 'single' || t === 'multiple' || t === 'multiple_with_other' || t === 'text';
}

function normalizeQuestion(raw: unknown): ClarifyingQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : null;
  const type = typeof o.type === 'string' && isQuestionType(o.type) ? o.type : null;
  if (!id || !title || !type) return null;

  let options: QuestionOption[] = [];
  if (Array.isArray(o.options)) {
    options = o.options
      .map((opt): QuestionOption | null => {
        if (!opt || typeof opt !== 'object') return null;
        const x = opt as Record<string, unknown>;
        const oid = typeof x.id === 'string' && x.id.trim() ? x.id.trim() : null;
        const label = typeof x.label === 'string' && x.label.trim() ? x.label.trim() : null;
        if (!oid || !label) return null;
        return { id: oid, label };
      })
      .filter((x): x is QuestionOption => x !== null);
  }

  if (type === 'text') {
    return { id, title, type: 'text', options: [] };
  }
  if (options.length === 0) return null;
  return { id, title, type, options };
}

/** First line only after marker (minified JSON). */
export function parseClarifyingQuestionsJson(jsonSlice: string): ClarifyingQuestion[] {
  const line = jsonSlice.trim().split(/\r?\n/)[0]?.trim() ?? '';
  if (!line) return [];
  try {
    const parsed = JSON.parse(line) as unknown;
    if (!parsed || typeof parsed !== 'object' || !('questions' in parsed)) return [];
    const arr = (parsed as { questions: unknown }).questions;
    if (!Array.isArray(arr)) return [];
    const out: ClarifyingQuestion[] = [];
    for (const item of arr) {
      const q = normalizeQuestion(item);
      if (q) out.push(q);
    }
    if (out.length < 1 || out.length > 8) return [];
    return out;
  } catch {
    return [];
  }
}

export function parseInferenceStreamComplete(raw: string): { narrative: string; questions: ClarifyingQuestion[] } {
  const { display, jsonSlice } = splitInferenceDisplayBuffer(raw);
  if (!jsonSlice) {
    return { narrative: raw.trimEnd(), questions: [] };
  }
  const questions = parseClarifyingQuestionsJson(jsonSlice);
  return { narrative: display.trimEnd(), questions };
}

export function formatAnswerForQuestion(q: ClarifyingQuestion, val: ClarificationAnswer | undefined): string {
  if (val === null || val === undefined) {
    return 'Skipped';
  }
  if (q.type === 'text') {
    if (typeof val === 'string' && val.trim()) return val.trim();
    return 'Skipped';
  }

  const labelFor = (id: string) => q.options.find((o) => o.id === id)?.label ?? id;

  if (typeof val === 'string') {
    return labelFor(val);
  }
  if (Array.isArray(val)) {
    return val.map(labelFor).join(', ');
  }
  if (typeof val === 'object' && 'selected' in val) {
    const parts = val.selected.map(labelFor);
    if (val.other) parts.push(val.other);
    return parts.join(', ');
  }
  return 'Skipped';
}

export function formatClarificationSummary(
  questions: ClarifyingQuestion[],
  answers: ClarificationAnswers,
): string {
  const lines: string[] = [];
  for (const q of questions) {
    const val = answers[q.id];
    const formatted = formatAnswerForQuestion(q, val);
    lines.push(`${q.title}\n→ ${formatted}`);
  }
  return 'Here are my clarifications:\n\n' + lines.join('\n\n');
}

/** v2 payload stored in features.inference_clarifications */
export type InferenceClarificationsV2 = {
  v: 2;
  questions: ClarifyingQuestion[];
  answers: ClarificationAnswers;
};

export function isInferenceClarificationsV2(val: unknown): val is InferenceClarificationsV2 {
  if (!val || typeof val !== 'object') return false;
  const o = val as Record<string, unknown>;
  if (o.v !== 2) return false;
  if (!Array.isArray(o.questions)) return false;
  if (o.answers === null || typeof o.answers !== 'object') return false;
  return true;
}
