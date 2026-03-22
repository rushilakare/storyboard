import { marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

marked.setOptions({
  gfm: true,
  breaks: false,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.use(gfm);

export function markdownToHtml(md: string): string {
  if (!md.trim()) return "<p></p>";
  const out = marked.parse(md, { async: false });
  return typeof out === "string" ? out : "<p></p>";
}

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html || "").trimEnd();
}
