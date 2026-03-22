"use client";

import "prosemirror-view/style/prosemirror.css";

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/core";
import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Gapcursor from "@tiptap/extension-gapcursor";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import pageStyles from "@/app/(main)/workspaces/[id]/page.module.css";
import { htmlToMarkdown, markdownToHtml } from "@/lib/prdMarkdownBridge";

function MarkdownPreview({
  markdown,
  ariaBusy,
}: {
  markdown: string;
  ariaBusy: boolean;
}) {
  return (
    <article
      className={`${pageStyles.docPaper} ${pageStyles.docPaperPreview}`}
      aria-busy={ariaBusy}
      aria-label={ariaBusy ? "Document updating" : "Document preview"}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown || "\u00a0"}</ReactMarkdown>
    </article>
  );
}

function ToolbarSep() {
  return (
    <span
      className={pageStyles.docToolbarSep}
      role="separator"
      aria-orientation="vertical"
      aria-hidden
    />
  );
}

function TableBubbleMenu({ editor }: { editor: Editor }) {
  const bubbleBtn = (label: string, ariaLabel: string, onClick: () => void, disabled?: boolean) => (
    <button
      type="button"
      className={pageStyles.docBubbleBtn}
      aria-label={ariaLabel}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="prdTableStructureMenu"
      shouldShow={({ editor: ed }) => ed.isActive("table")}
      options={{ placement: "top", offset: 10, flip: true, shift: true }}
      className={pageStyles.docTableBubble}
    >
      {bubbleBtn("Row ↑", "Add row above", () => editor.chain().focus().addRowBefore().run())}
      {bubbleBtn("Row ↓", "Add row below", () => editor.chain().focus().addRowAfter().run())}
      {bubbleBtn("Del row", "Delete row", () => editor.chain().focus().deleteRow().run())}
      {bubbleBtn("Col ←", "Add column left", () => editor.chain().focus().addColumnBefore().run())}
      {bubbleBtn("Col →", "Add column right", () => editor.chain().focus().addColumnAfter().run())}
      {bubbleBtn("Del col", "Delete column", () => editor.chain().focus().deleteColumn().run())}
      {bubbleBtn("Header", "Toggle header row", () => editor.chain().focus().toggleHeaderRow().run())}
      {bubbleBtn("Merge", "Merge or split cells", () => editor.chain().focus().mergeOrSplit().run())}
      {bubbleBtn("Del table", "Delete table", () => editor.chain().focus().deleteTable().run())}
    </BubbleMenu>
  );
}

function EditorToolbar({ editor }: { editor: Editor }) {
  const ui = useEditorState({
    editor,
    selector: (s) => ({
      bold: s.editor.isActive("bold"),
      italic: s.editor.isActive("italic"),
      h2: s.editor.isActive("heading", { level: 2 }),
      h3: s.editor.isActive("heading", { level: 3 }),
      bullet: s.editor.isActive("bulletList"),
      ordered: s.editor.isActive("orderedList"),
      quote: s.editor.isActive("blockquote"),
      code: s.editor.isActive("codeBlock"),
      link: s.editor.isActive("link"),
      transactionNumber: s.transactionNumber,
    }),
  });

  const btn = (label: string, active: boolean, onClick: () => void) => (
    <button
      type="button"
      className={pageStyles.docToolbarBtn}
      data-active={active ? "true" : "false"}
      aria-pressed={active}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className={pageStyles.docToolbar} role="toolbar" aria-label="Formatting">
      {btn("Bold", ui.bold, () => editor.chain().focus().toggleBold().run())}
      {btn("Italic", ui.italic, () => editor.chain().focus().toggleItalic().run())}
      <ToolbarSep />
      {btn("H2", ui.h2, () => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      {btn("H3", ui.h3, () => editor.chain().focus().toggleHeading({ level: 3 }).run())}
      <ToolbarSep />
      {btn("List", ui.bullet, () => editor.chain().focus().toggleBulletList().run())}
      {btn("Ordered", ui.ordered, () => editor.chain().focus().toggleOrderedList().run())}
      <ToolbarSep />
      {btn("Quote", ui.quote, () => editor.chain().focus().toggleBlockquote().run())}
      {btn("Code", ui.code, () => editor.chain().focus().toggleCodeBlock().run())}
      <ToolbarSep />
      {btn("Divider", false, () => editor.chain().focus().setHorizontalRule().run())}
      <ToolbarSep />
      {btn(
        "Table",
        false,
        () =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      )}
      {btn("Link", ui.link, () => {
        const prev = editor.getAttributes("link").href as string | undefined;
        const href =
          typeof window !== "undefined"
            ? window.prompt("Link URL", prev ?? "https://")
            : null;
        if (href === null) return;
        if (href === "") {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          return;
        }
        editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
      })}
    </div>
  );
}

function TiptapEditor({
  value,
  onChange,
  syncKey,
  disabled,
}: {
  value: string;
  onChange: (markdown: string) => void;
  syncKey: string;
  disabled?: boolean;
}) {
  const lastFromEditor = useRef<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
      }),
      Placeholder.configure({
        placeholder: "Edit your PRD…",
      }),
      Gapcursor,
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: markdownToHtml(value),
    editorProps: {
      attributes: {
        class: pageStyles.docProseMirror,
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = htmlToMarkdown(ed.getHTML());
      lastFromEditor.current = md;
      onChange(md);
    },
  });

  useEffect(() => {
    lastFromEditor.current = null;
  }, [syncKey]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    if (value === lastFromEditor.current) return;
    lastFromEditor.current = value;
    editor.commands.setContent(markdownToHtml(value), { emitUpdate: false });
  }, [value, editor, syncKey]);

  if (!editor) {
    return (
      <div className={`${pageStyles.docPaper} ${pageStyles.docEditorWrap}`}>
        <p className={pageStyles.emptyState}>Loading editor…</p>
      </div>
    );
  }

  return (
    <div className={`${pageStyles.docPaper} ${pageStyles.docEditorWrap}`}>
      <EditorToolbar editor={editor} />
      <TableBubbleMenu editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

export default function PrdDocumentEditor({
  value,
  onChange,
  readOnly,
  streaming,
  syncKey,
  ariaBusy,
  disabled,
}: {
  value: string;
  onChange?: (markdown: string) => void;
  readOnly: boolean;
  streaming: boolean;
  syncKey: string;
  ariaBusy: boolean;
  disabled?: boolean;
}) {
  const showPreview = readOnly || streaming;

  if (showPreview) {
    return <MarkdownPreview markdown={value} ariaBusy={ariaBusy} />;
  }

  if (!onChange) {
    return <MarkdownPreview markdown={value} ariaBusy={ariaBusy} />;
  }

  return (
    <TiptapEditor
      value={value}
      onChange={onChange}
      syncKey={syncKey}
      disabled={disabled}
    />
  );
}
