/** Character budgets for `/discuss` prompt sections (keep total prompt bounded). */

export const DISCUSS_ARTIFACT_MAX_CHARS = 14_000;
export const DISCUSS_TRANSCRIPT_MAX_CHARS = 28_000;
export const DISCUSS_TRANSCRIPT_PER_MESSAGE_MAX = 6_000;

export function truncateForDiscuss(text: string, maxChars: number): { text: string; truncated: boolean } {
  const t = text ?? '';
  if (t.length <= maxChars) return { text: t, truncated: false };
  return {
    text: `${t.slice(0, maxChars)}\n\n[…truncated for context limit — full text lives in artifacts or chat history.]`,
    truncated: true,
  };
}

export function formatArtifactBlock(label: string, body: string | null | undefined, maxChars: number): string {
  const raw = (body ?? '').trim();
  if (!raw) return `${label}\n(none saved yet.)`;
  const { text, truncated } = truncateForDiscuss(raw, maxChars);
  const note = truncated ? ' (excerpt)' : '';
  return `${label}${note}\n${text}`;
}

export type DiscussMessageRow = {
  role: string;
  content: string;
  agent_type: string | null;
};

function speakerLabel(role: string, agent_type: string | null): string {
  if (role === 'user') return 'User';
  if (role === 'system') return 'System';
  if (role === 'assistant') {
    const t = agent_type?.trim();
    return t ? `Assistant (${t})` : 'Assistant';
  }
  return role;
}

/**
 * `messages` must be chronological (oldest → newest). Keeps the newest turns that fit the budget.
 */
export function buildDiscussTranscriptFromMessages(
  messages: DiscussMessageRow[],
  totalMaxChars: number,
  perMessageMax: number,
): string {
  if (!messages.length) return '(No prior messages on this feature.)';

  const blocks: string[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const content = (m.content ?? '').trim();
    if (!content) continue;

    const { text: clipped } = truncateForDiscuss(content, perMessageMax);
    const head = speakerLabel(m.role, m.agent_type);
    const block = `${head}:\n${clipped}`;
    const sep = blocks.length ? '\n\n---\n\n' : '';
    const addLen = (blocks.length ? sep.length : 0) + block.length;
    if (used + addLen > totalMaxChars) break;
    blocks.unshift(block);
    used += addLen;
  }

  if (!blocks.length) return '(No prior messages on this feature.)';
  return blocks.join('\n\n---\n\n');
}
