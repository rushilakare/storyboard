const MAX_LEN = 80;

/**
 * Prefer first ATX heading, else first substantial line; then fallbacks (e.g. feature name).
 */
export function deriveDocumentTitle(
  markdown: string,
  fallbacks: readonly (string | null | undefined)[],
): string {
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, ' ');
  const withoutInline = withoutFences.replace(/`[^`]+`/g, ' ');

  const hm = /^#{1,6}\s+(.+)$/m.exec(withoutInline);
  if (hm) {
    const t = hm[1].trim().replace(/\s+/g, ' ');
    if (t) return t.slice(0, MAX_LEN);
  }

  for (const line of withoutInline.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('#')) continue;
    if (/^[-*]\s/.test(t)) continue;
    const collapsed = t.replace(/\s+/g, ' ');
    if (collapsed) return collapsed.slice(0, MAX_LEN);
  }

  for (const f of fallbacks) {
    const t = f?.trim();
    if (t) return t.slice(0, MAX_LEN);
  }

  return 'Untitled';
}
