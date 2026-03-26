"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import styles from "./FeatureArtifactsModal.module.css";

export type FeatureArtifactSummary = {
  id: string;
  kind: string;
  title: string | null;
  version: number;
  updated_at: string;
  is_draft: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  featureId: string;
  kindLabel: (kind: string) => string;
  formatTimeAgo: (iso: string) => string;
  onOpenArtifact: (row: FeatureArtifactSummary) => void;
};

export default function FeatureArtifactsModal({
  open,
  onClose,
  featureId,
  kindLabel,
  formatTimeAgo,
  onOpenArtifact,
}: Props) {
  const [rows, setRows] = useState<FeatureArtifactSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/features/${featureId}/artifacts?summary=1`,
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to load",
        );
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Failed to load artifacts");
    } finally {
      setLoading(false);
    }
  }, [featureId]);

  useEffect(() => {
    if (!open || !featureId) return;
    void load();
  }, [open, featureId, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-artifacts-modal-title"
      >
        <div className={styles.header}>
          <h2 id="feature-artifacts-modal-title" className={styles.title}>
            Artifacts for this feature
          </h2>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loading}>Loading…</div>
          ) : error ? (
            <div className={styles.error} role="alert">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className={styles.empty}>No artifacts yet.</div>
          ) : (
            <ul className={styles.list}>
              {rows.map((r) => (
                <li key={r.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div className={styles.rowMeta}>
                      <span className={styles.kindBadge}>{kindLabel(r.kind)}</span>
                      {r.version > 1 ? (
                        <span className={styles.draftBadge}>v{r.version}</span>
                      ) : null}
                      {r.is_draft ? (
                        <span className={styles.draftBadge}>Draft</span>
                      ) : null}
                    </div>
                    <p className={styles.rowTitle}>{r.title ?? "Untitled"}</p>
                    <div className={styles.rowDate}>{formatTimeAgo(r.updated_at)}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.openBtn}
                    onClick={() => onOpenArtifact(r)}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
