"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PrdDocumentEditor from "@/components/PrdDocumentEditor";
import { buildArtifactFilename, downloadMarkdownFile } from "@/lib/artifactExport";
import styles from "./FeatureArtifactsPanel.module.css";

export type FeatureArtifactSummary = {
  id: string;
  kind: string;
  title: string | null;
  version: number;
  updated_at: string;
  is_draft: boolean;
};

type HeaderMeta = {
  kind: string;
  title: string;
};

type Props = {
  workspaceId: string;
  featureId: string;
  artifactId: string | null;
  kindLabel: (kind: string) => string;
  formatTimeAgo: (iso: string) => string;
  onHeaderMeta: (meta: HeaderMeta | null) => void;
};

export default function FeatureArtifactsPanel({
  workspaceId,
  featureId,
  artifactId,
  kindLabel,
  formatTimeAgo,
  onHeaderMeta,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<FeatureArtifactSummary[]>([]);
  const [listLoading, setListLoading] = useState(!artifactId);
  const [listError, setListError] = useState<string | null>(null);

  const [detailBody, setDetailBody] = useState<string>("");
  const [detailKind, setDetailKind] = useState<string>("");
  const [detailTitle, setDetailTitle] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const pushArtifactUrl = useCallback(
    (nextArtifactId: string | null) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set("feature", featureId);
      p.set("panel", "artifacts");
      if (nextArtifactId) {
        p.set("artifact", nextArtifactId);
      } else {
        p.delete("artifact");
      }
      router.push(`/workspaces/${workspaceId}?${p.toString()}`);
    },
    [router, workspaceId, searchParams, featureId],
  );

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await fetch(`/api/features/${featureId}/artifacts?summary=1`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Failed to load");
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setRows([]);
      setListError(e instanceof Error ? e.message : "Failed to load artifacts");
    } finally {
      setListLoading(false);
    }
  }, [featureId]);

  useEffect(() => {
    if (artifactId) return;
    void loadList();
  }, [artifactId, loadList]);

  useEffect(() => {
    if (!artifactId) {
      onHeaderMeta(null);
    }
  }, [artifactId, onHeaderMeta]);

  useEffect(() => {
    if (!artifactId) {
      setDetailBody("");
      setDetailKind("");
      setDetailTitle(null);
      setDetailVersion(0);
      setDetailError(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    (async () => {
      try {
        const res = await fetch(`/api/features/${featureId}/artifacts/${artifactId}`);
        const data = (await res.json()) as {
          body?: string;
          kind?: string;
          title?: string | null;
          version?: number;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setDetailError(typeof data.error === "string" ? data.error : "Failed to load");
          onHeaderMeta(null);
          return;
        }
        const k = data.kind ?? "";
        const t = data.title ?? null;
        const v = typeof data.version === "number" ? data.version : 0;
        setDetailBody(data.body ?? "");
        setDetailKind(k);
        setDetailTitle(t);
        setDetailVersion(v);
        onHeaderMeta({
          kind: k,
          title: t?.trim() || kindLabel(k) || "Artifact",
        });
      } catch {
        if (!cancelled) {
          setDetailError("Network error");
          onHeaderMeta(null);
        }
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artifactId, featureId, kindLabel, onHeaderMeta]);

  const handleDownload = useCallback(() => {
    if (!artifactId || !detailBody) return;
    const name = buildArtifactFilename(detailKind, detailTitle, detailVersion);
    downloadMarkdownFile(detailBody, name);
  }, [artifactId, detailBody, detailKind, detailTitle, detailVersion]);

  if (!artifactId) {
    return (
      <div className={styles.root}>
        {listLoading ? (
          <div className={styles.loading}>Loading artifacts…</div>
        ) : listError ? (
          <div className={styles.error} role="alert">
            {listError}
          </div>
        ) : rows.length === 0 ? (
          <div className={styles.empty}>No artifacts yet.</div>
        ) : (
          <div className={styles.listScroll}>
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                className={styles.row}
                onClick={() => pushArtifactUrl(r.id)}
              >
                <div className={styles.rowMeta}>
                  <span className={styles.kindBadge}>{kindLabel(r.kind)}</span>
                  {r.version > 1 ? (
                    <span className={styles.versionMuted}>v{r.version}</span>
                  ) : null}
                  {r.is_draft ? (
                    <span className={styles.versionMuted}>Draft</span>
                  ) : null}
                </div>
                <p className={styles.rowTitle}>{r.title ?? "Untitled"}</p>
                <div className={styles.rowDate}>{formatTimeAgo(r.updated_at)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.backBtn} onClick={() => pushArtifactUrl(null)}>
          ← All artifacts
        </button>
        <button
          type="button"
          className={styles.downloadBtn}
          disabled={detailLoading || !!detailError || !detailBody.trim()}
          onClick={handleDownload}
        >
          Download
        </button>
      </div>
      <div className={styles.detailBody}>
        {detailLoading ? (
          <div className={styles.loading}>Loading…</div>
        ) : detailError ? (
          <div className={styles.error} role="alert">
            {detailError}
          </div>
        ) : (
          <div className={styles.editorWrap}>
            <PrdDocumentEditor
              syncKey={artifactId}
              readOnly
              streaming={false}
              ariaBusy={false}
              value={detailBody}
            />
          </div>
        )}
      </div>
    </div>
  );
}
