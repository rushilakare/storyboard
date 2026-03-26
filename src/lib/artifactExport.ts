const MAX_FILENAME_LEN = 120;

function slugifySegment(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'artifact';
}

export function buildArtifactFilename(
  kind: string,
  title: string | null,
  version: number,
): string {
  const base = title?.trim()
    ? slugifySegment(title)
    : slugifySegment(kind);
  const v = version > 0 ? `-v${version}` : '';
  const name = `${base}${v}.md`.slice(0, MAX_FILENAME_LEN);
  return name.endsWith('.md') ? name : `${name}.md`;
}

export function downloadMarkdownFile(text: string, filename: string): void {
  const blob = new Blob([text], {
    type: 'text/markdown;charset=utf-8',
  });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Strip `.md` for Word export `filenameStem`. */
export function markdownFilenameToStem(filename: string): string {
  return filename.replace(/\.md$/i, '') || 'export';
}

export type CopyPlainTextResult =
  | { ok: true }
  | { ok: false; error: string };

export async function copyPlainText(text: string): Promise<CopyPlainTextResult> {
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Clipboard failed';
    return { ok: false, error: msg };
  }
}

export type DocxExportResult =
  | { ok: true }
  | { ok: false; error: string };

export async function downloadDocxForFeature(
  featureId: string,
  markdown: string,
  filenameMd: string,
): Promise<DocxExportResult> {
  const stem = markdownFilenameToStem(filenameMd);
  try {
    const res = await fetch(
      `/api/features/${featureId}/artifacts/export-docx`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, filenameStem: stem }),
      },
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error: j.error ?? `Word export failed (${res.status})`,
      };
    }
    const blob = await res.blob();
    downloadBlob(blob, `${stem}.docx`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Word export failed',
    };
  }
}
