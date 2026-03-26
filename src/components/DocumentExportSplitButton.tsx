"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  buildArtifactFilename,
  copyPlainText,
  downloadDocxForFeature,
  downloadMarkdownFile,
} from "@/lib/artifactExport";
import styles from "./DocumentExportSplitButton.module.css";

type DocumentExportSplitButtonProps = {
  markdown: string;
  filename: string;
  featureId?: string | null;
  disabled?: boolean;
  size?: "default" | "compact";
};

export function DocumentExportSplitButton({
  markdown,
  filename,
  featureId,
  disabled = false,
  size = "default",
}: DocumentExportSplitButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [docxBusy, setDocxBusy] = useState(false);
  const [docxError, setDocxError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  const doDownload = useCallback(() => {
    if (disabled || !markdown) return;
    downloadMarkdownFile(markdown, filename);
    closeMenu();
  }, [disabled, markdown, filename, closeMenu]);

  const doCopy = useCallback(async () => {
    if (disabled || !markdown) return;
    const r = await copyPlainText(markdown);
    closeMenu();
    if (r.ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [disabled, markdown, closeMenu]);

  const doDocx = useCallback(async () => {
    if (disabled || !markdown.trim() || !featureId) return;
    setDocxError(null);
    setDocxBusy(true);
    try {
      const r = await downloadDocxForFeature(featureId, markdown, filename);
      closeMenu();
      if (!r.ok) setDocxError(r.error);
    } finally {
      setDocxBusy(false);
    }
  }, [disabled, markdown, featureId, filename, closeMenu]);

  const empty = !markdown.trim();
  const effectiveDisabled = disabled || empty;
  const docxDisabled = effectiveDisabled || !featureId || docxBusy;

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${size === "compact" ? styles.compact : ""}`}
    >
      <div className={styles.split}>
        <button
          type="button"
          className={styles.primary}
          disabled={effectiveDisabled}
          onClick={doDownload}
        >
          Download
        </button>
        <button
          type="button"
          className={styles.chevron}
          disabled={effectiveDisabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More download options"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <ChevronDown className={styles.chevronIcon} aria-hidden />
        </button>
      </div>
      {menuOpen ? (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={effectiveDisabled}
            onClick={doDownload}
          >
            Download Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={effectiveDisabled}
            onClick={() => void doCopy()}
          >
            Copy as-is
          </button>
          {featureId ? (
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              disabled={docxDisabled}
              onClick={() => void doDocx()}
            >
              Download Word (.docx)
            </button>
          ) : null}
        </div>
      ) : null}
      {copied ? (
        <span className={styles.status} aria-live="polite">
          Copied
        </span>
      ) : null}
      {docxError ? (
        <span className={styles.status} role="alert">
          {docxError}
        </span>
      ) : null}
    </div>
  );
}

type ArtifactListExportSplitButtonProps = {
  featureId: string;
  artifactId: string;
  kind: string;
  title: string | null;
  version: number;
  size?: "default" | "compact";
};

type ArtifactGetJson = {
  body?: string;
  kind?: string;
  title?: string | null;
  version?: number;
  error?: string;
};

export function ArtifactListExportSplitButton({
  featureId,
  artifactId,
  kind,
  title,
  version,
  size = "compact",
}: ArtifactListExportSplitButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<{ markdown: string; filename: string } | null>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    cacheRef.current = null;
  }, [featureId, artifactId]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  const loadArtifact = useCallback(async () => {
    if (cacheRef.current) return cacheRef.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/features/${featureId}/artifacts/${artifactId}`,
      );
      const data = (await res.json()) as ArtifactGetJson;
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : `Error ${res.status}`,
        );
      }
      const markdown = data.body ?? "";
      const filename = buildArtifactFilename(
        typeof data.kind === "string" ? data.kind : kind,
        data.title ?? title,
        typeof data.version === "number" ? data.version : version,
      );
      const out = { markdown, filename };
      cacheRef.current = out;
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load";
      setError(msg);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [featureId, artifactId, kind, title, version]);

  const doDownload = useCallback(async () => {
    try {
      const { markdown, filename } = await loadArtifact();
      if (!markdown.trim()) {
        setError("No content to download");
        return;
      }
      downloadMarkdownFile(markdown, filename);
      closeMenu();
    } catch {
      /* loadArtifact set error */
    }
  }, [loadArtifact, closeMenu]);

  const doCopy = useCallback(async () => {
    try {
      const { markdown } = await loadArtifact();
      if (!markdown.trim()) {
        setError("No content to copy");
        return;
      }
      const r = await copyPlainText(markdown);
      closeMenu();
      if (r.ok) {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } else {
        setError(r.error);
      }
    } catch {
      /* loadArtifact set error */
    }
  }, [loadArtifact, closeMenu]);

  const doDocx = useCallback(async () => {
    setError(null);
    try {
      const { markdown, filename } = await loadArtifact();
      if (!markdown.trim()) {
        setError("No content to export");
        return;
      }
      const r = await downloadDocxForFeature(featureId, markdown, filename);
      closeMenu();
      if (!r.ok) setError(r.error);
    } catch {
      /* loadArtifact set error */
    }
  }, [loadArtifact, featureId, closeMenu]);

  const effectiveDisabled = busy;

  return (
    <div
      ref={wrapRef}
      className={`${styles.wrap} ${size === "compact" ? styles.compact : ""}`}
    >
      <div className={styles.split}>
        <button
          type="button"
          className={styles.primary}
          disabled={effectiveDisabled}
          onClick={() => void doDownload()}
        >
          {busy ? "…" : "Download"}
        </button>
        <button
          type="button"
          className={styles.chevron}
          disabled={effectiveDisabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More download options"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <ChevronDown className={styles.chevronIcon} aria-hidden />
        </button>
      </div>
      {menuOpen ? (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={effectiveDisabled}
            onClick={() => void doDownload()}
          >
            Download Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={effectiveDisabled}
            onClick={() => void doCopy()}
          >
            Copy as-is
          </button>
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            disabled={effectiveDisabled}
            onClick={() => void doDocx()}
          >
            Download Word (.docx)
          </button>
        </div>
      ) : null}
      {error ? (
        <span className={styles.status} role="alert">
          {error}
        </span>
      ) : null}
      {copied && !error ? (
        <span className={styles.status} aria-live="polite">
          Copied
        </span>
      ) : null}
    </div>
  );
}
