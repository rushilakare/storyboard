"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FeatureIssue } from "@/lib/database.types";
import GenerateIssuesModal from "@/components/GenerateIssuesModal";
import IssueDetailLayout from "./IssueDetailLayout";
import styles from "./FeatureIssuesPanel.module.css";

type Props = {
  featureId: string;
  workspaceId: string;
  workspaceName: string;
  featureName: string;
  /** Increment (e.g. from chat) to open the generate modal and auto-run generation. */
  launchGenerateToken?: number;
  /** Called once after handling a non-zero token so the parent can reset the counter. */
  onLaunchGenerateConsumed?: () => void;
  /** After issues are saved from the generate modal (new or replace). */
  onIssuesCommitted?: () => void;
};

function normalizeIssue(row: FeatureIssue): FeatureIssue {
  return {
    ...row,
    due_date: row.due_date ?? null,
    generated_from: row.generated_from ?? null,
  };
}

export default function FeatureIssuesPanel({
  featureId,
  workspaceId,
  workspaceName,
  featureName,
  launchGenerateToken = 0,
  onLaunchGenerateConsumed,
  onIssuesCommitted,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [epic, setEpic] = useState<FeatureIssue | null>(null);
  const [stories, setStories] = useState<FeatureIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [autoStartGenerate, setAutoStartGenerate] = useState(false);

  useEffect(() => {
    if (launchGenerateToken <= 0) return;
    setGenerateOpen(true);
    setAutoStartGenerate(true);
    onLaunchGenerateConsumed?.();
  }, [launchGenerateToken, onLaunchGenerateConsumed]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/features/${featureId}/issues`);
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Failed to load issues");
        setEpic(null);
        setStories([]);
        return;
      }
      const e = data.epic ? normalizeIssue(data.epic as FeatureIssue) : null;
      const s = Array.isArray(data.stories)
        ? (data.stories as FeatureIssue[]).map(normalizeIssue)
        : [];
      setEpic(e);
      setStories(s);
      setSelectedId((prev) => {
        if (prev && (e?.id === prev || s.some((x) => x.id === prev))) return prev;
        if (e) return e.id;
        if (s[0]) return s[0].id;
        return null;
      });
    } catch {
      setError("Network error");
      setEpic(null);
      setStories([]);
    } finally {
      setLoading(false);
    }
  }, [featureId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => {
    const m = new Map<string, FeatureIssue>();
    if (epic) m.set(epic.id, epic);
    for (const st of stories) m.set(st.id, st);
    return m;
  }, [epic, stories]);

  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const parentEpic =
    selected?.type === "story" && selected.parent_id ? byId.get(selected.parent_id) ?? null : null;

  const childStories = useMemo(() => {
    if (!epic) return [];
    return [...stories]
      .filter((s) => s.parent_id === epic.id)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [epic, stories]);

  const listRows = useMemo(() => {
    const rows: { issue: FeatureIssue; indent: boolean }[] = [];
    if (epic) rows.push({ issue: epic, indent: false });
    const ordered = [...stories].sort((a, b) => a.sort_order - b.sort_order);
    for (const st of ordered) {
      rows.push({ issue: st, indent: true });
    }
    return rows;
  }, [epic, stories]);

  const patchIssue = useCallback(
    async (patch: {
      status?: FeatureIssue["status"];
      priority?: FeatureIssue["priority"];
      due_date?: string | null;
    }) => {
      if (!selectedId) return;
      const res = await fetch(`/api/features/${featureId}/issues/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      const updated = normalizeIssue((await res.json()) as FeatureIssue);
      if (updated.type === "epic") {
        setEpic(updated);
      } else {
        setStories((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      }
    },
    [featureId, selectedId],
  );

  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.loading}>Loading issues…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.root}>
        <div className={styles.error} role="alert">
          {error}
        </div>
        <GenerateIssuesModal
          open={generateOpen}
          onClose={() => {
            setGenerateOpen(false);
            setAutoStartGenerate(false);
          }}
          featureOptions={[{ id: featureId, name: featureName }]}
          defaultFeatureId={featureId}
          lockedFeatureId={featureId}
          autoStartGenerate={autoStartGenerate}
          onAfterCommit={() => {
            void load();
            setGenerateOpen(false);
            setAutoStartGenerate(false);
            onIssuesCommitted?.();
          }}
        />
      </div>
    );
  }

  const hasIssues = epic || stories.length > 0;

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <h2 className={styles.toolbarTitle}>Issues</h2>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void load()}
          >
            Refresh
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={() => setGenerateOpen(true)}
          >
            {hasIssues ? "Regenerate…" : "Generate issues"}
          </button>
        </div>
      </div>

      {!hasIssues ? (
        <div className={styles.emptyDetail}>
          No issues yet. Generate an epic and stories from feature inference and competitor analysis.
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.listCol}>
            <div className={styles.listHeader}>Backlog</div>
            <div className={styles.listScroll}>
              {listRows.map(({ issue: iss, indent }) => (
                <button
                  key={iss.id}
                  type="button"
                  className={`${styles.row} ${selectedId === iss.id ? styles.rowActive : ""} ${indent ? styles.storyIndent : ""}`}
                  onClick={() => setSelectedId(iss.id)}
                >
                  <span className={styles.rowMeta}>
                    {iss.issue_key} · {iss.type}
                  </span>
                  <span className={styles.rowTitle}>{iss.title}</span>
                </button>
              ))}
            </div>
          </div>
          <div className={styles.detailCol}>
            {selected ? (
              <IssueDetailLayout
                workspaceId={workspaceId}
                workspaceName={workspaceName}
                featureName={featureName}
                featureId={featureId}
                issue={selected}
                parentEpic={parentEpic}
                childStories={selected.type === "epic" ? childStories : []}
                onSelectIssue={(id) => setSelectedId(id)}
                onPatch={patchIssue}
              />
            ) : (
              <div className={styles.emptyDetail}>Select an issue.</div>
            )}
          </div>
        </div>
      )}

      <GenerateIssuesModal
        open={generateOpen}
        onClose={() => {
          setGenerateOpen(false);
          setAutoStartGenerate(false);
        }}
        featureOptions={[{ id: featureId, name: featureName }]}
        defaultFeatureId={featureId}
        lockedFeatureId={featureId}
        autoStartGenerate={autoStartGenerate}
        onAfterCommit={() => {
          void load();
          setGenerateOpen(false);
          setAutoStartGenerate(false);
          onIssuesCommitted?.();
        }}
      />
    </div>
  );
}
