"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import styles from "./GenerateIssuesModal.module.css";

type SourceInfo = {
  inference: { version: number; updatedAt: string } | null;
  competitor: { version: number; updatedAt: string } | null;
};

type PreviewStory = {
  externalRef: string;
  title: string;
  /** Engineer-facing scope (2–3 sentences); folded into notes on commit. */
  description: string;
  persona: string;
  narrative: string;
  notes: string;
  acceptanceCriteria: string[];
  due_date: string | null;
  status: string;
  priority: string;
  include: boolean;
};

function formatGenerateError(err: unknown): string {
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "Generation failed";
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  featureOptions: { id: string; name: string }[];
  defaultFeatureId: string | null;
  lockedFeatureId?: string | null;
  onAfterCommit?: () => void;
  /** When true on open, immediately POST /issues/generate (e.g. chat “Yes, generate issues”). */
  autoStartGenerate?: boolean;
};

export default function GenerateIssuesModal({
  open,
  onClose,
  featureOptions,
  defaultFeatureId,
  lockedFeatureId,
  onAfterCommit,
  autoStartGenerate = false,
}: Props) {
  const autoStartConsumedRef = useRef(false);
  const [featureId, setFeatureId] = useState<string>("");
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [epicTitle, setEpicTitle] = useState("");
  const [epicDescription, setEpicDescription] = useState("");
  const [epicAc, setEpicAc] = useState<string[]>([]);
  const [epicDue, setEpicDue] = useState("");
  const [stories, setStories] = useState<PreviewStory[]>([]);
  const [phase, setPhase] = useState<"pick" | "review">("pick");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      autoStartConsumedRef.current = false;
      return;
    }
    setError(null);
    setPhase("pick");
    setSource(null);
    setEpicTitle("");
    setEpicDescription("");
    setEpicAc([]);
    setEpicDue("");
    setStories([]);
    const initial = lockedFeatureId ?? defaultFeatureId ?? "";
    setFeatureId(initial);
  }, [open, lockedFeatureId, defaultFeatureId]);

  const runGenerate = useCallback(async () => {
    const fid = lockedFeatureId ?? featureId;
    if (!fid) {
      setError("Select a feature.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/features/${fid}/issues/generate`, { method: "POST" });
      const data = (await res.json()) as {
        error?: string | unknown;
        rawExcerpt?: string;
        source?: SourceInfo;
        epic?: {
          title: string;
          description: string;
          acceptance_criteria?: string[];
          due_date?: string | null;
        };
        stories?: Array<{
          externalRef: string;
          title: string;
          description?: string;
          persona?: string;
          narrative?: string;
          notes?: string;
          acceptanceCriteria?: string[];
          due_date?: string | null;
          status?: string;
          priority?: string;
          include?: boolean;
        }>;
      };
      if (!res.ok) {
        setError(data.error !== undefined ? formatGenerateError(data.error) : "Generation failed");
        return;
      }
      setSource(data.source ?? null);
      setEpicTitle(data.epic?.title ?? "");
      setEpicDescription(data.epic?.description ?? "");
      setEpicAc(Array.isArray(data.epic?.acceptance_criteria) ? data.epic!.acceptance_criteria! : []);
      setEpicDue(
        data.epic?.due_date && typeof data.epic.due_date === "string"
          ? data.epic.due_date.slice(0, 10)
          : "",
      );
      setStories(
        (data.stories ?? []).map((s) => ({
          externalRef: s.externalRef,
          title: s.title,
          description: s.description ?? "",
          persona: s.persona ?? "",
          narrative: s.narrative ?? "",
          notes: s.notes ?? "",
          acceptanceCriteria: Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [],
          due_date: s.due_date ?? null,
          status: s.status ?? "open",
          priority: s.priority ?? "medium",
          include: s.include !== false,
        })),
      );
      setPhase("review");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [featureId, lockedFeatureId]);

  useEffect(() => {
    if (!open || !autoStartGenerate) return;
    if (autoStartConsumedRef.current) return;
    const fid = lockedFeatureId ?? defaultFeatureId ?? featureId;
    if (!fid) return;
    autoStartConsumedRef.current = true;
    void runGenerate();
  }, [open, autoStartGenerate, lockedFeatureId, defaultFeatureId, featureId, runGenerate]);

  const runCommit = useCallback(
    async (replace: boolean) => {
      const fid = lockedFeatureId ?? featureId;
      if (!fid) return;
      setCommitting(true);
      setError(null);
      try {
        const doRequest = async (r: boolean) =>
          fetch(`/api/features/${fid}/issues/commit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              replace: r,
              generated_from: "inference_competitor",
              epic: {
                title: epicTitle,
                description: epicDescription,
                acceptance_criteria: epicAc,
                due_date: epicDue || null,
              },
              stories: stories.map((s) => ({
                externalRef: s.externalRef,
                title: s.title,
                persona: s.persona,
                narrative: s.narrative,
                notes: [
                  s.description.trim() && `**Scope:** ${s.description.trim()}`,
                  s.notes.trim(),
                ]
                  .filter(Boolean)
                  .join("\n\n"),
                acceptanceCriteria: s.acceptanceCriteria,
                due_date: s.due_date,
                status: s.status,
                priority: s.priority,
                include: s.include,
              })),
            }),
          });

        let res = await doRequest(replace);
        let data = (await res.json()) as { error?: string };
        if (res.status === 409) {
          const ok = window.confirm(
            "Issues already exist for this feature. Replace them with this set?",
          );
          if (ok) {
            res = await doRequest(true);
            data = (await res.json()) as { error?: string };
          } else {
            return;
          }
        }
        if (!res.ok) {
          setError(typeof data.error === "string" ? data.error : "Failed to create issues");
          return;
        }
        onAfterCommit?.();
        onClose();
      } catch {
        setError("Network error");
      } finally {
        setCommitting(false);
      }
    },
    [lockedFeatureId, featureId, epicTitle, epicDescription, epicAc, epicDue, stories, onAfterCommit, onClose],
  );

  if (!open) return null;

  const showPicker = !lockedFeatureId;

  const formatSource = (s: SourceInfo | null) => {
    if (!s) return null;
    const parts: string[] = [];
    if (s.inference) parts.push(`Inference v${s.inference.version}`);
    if (s.competitor) parts.push(`Competitors v${s.competitor.version}`);
    return parts.length ? parts.join(" · ") : null;
  };

  return (
    <div className={styles.overlay} role="presentation" onClick={onClose}>
      <div
        className={styles.panel}
        role="dialog"
        aria-labelledby="gen-issues-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div>
            <h2 id="gen-issues-title" className={styles.title}>
              Generate issues
            </h2>
            <p className={styles.subtitle}>
              {formatSource(source)
                ? `From ${formatSource(source)}`
                : "Uses latest feature inference and competitor analysis on the server."}
            </p>
          </div>
          <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onClose}>
            <X size={20} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className={styles.body}>
          {error ? (
            <div className={styles.errorText} role="alert">
              {error}
            </div>
          ) : null}

          {phase === "pick" ? (
            <>
              {showPicker ? (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="gen-issues-feature">
                    Feature
                  </label>
                  <select
                    id="gen-issues-feature"
                    className={styles.select}
                    value={featureId}
                    onChange={(e) => setFeatureId(e.target.value)}
                  >
                    <option value="">Select feature…</option>
                    {featureOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <button
                type="button"
                className={styles.previewBtn}
                disabled={loading || (!lockedFeatureId && !featureId)}
                onClick={() => void runGenerate()}
              >
                {loading ? "Generating…" : "Generate from inference & competitor"}
              </button>
            </>
          ) : null}

          {phase === "review" ? (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="gen-epic-title">
                  Epic title
                </label>
                <input
                  id="gen-epic-title"
                  className={styles.input}
                  value={epicTitle}
                  onChange={(e) => setEpicTitle(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="gen-epic-desc">
                  Epic description
                </label>
                <textarea
                  id="gen-epic-desc"
                  className={styles.textarea}
                  value={epicDescription}
                  onChange={(e) => setEpicDescription(e.target.value)}
                  rows={8}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="gen-epic-due">
                  Epic due date
                </label>
                <input
                  id="gen-epic-due"
                  className={styles.input}
                  type="date"
                  value={epicDue}
                  onChange={(e) => setEpicDue(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <span className={styles.label}>Stories</span>
                {stories.length === 0 ? (
                  <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
                    No stories returned. Try again or extend the inference/competitor documents.
                  </p>
                ) : (
                  <table className={styles.storyTable}>
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>✓</th>
                        <th>Ref</th>
                        <th>Title</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stories.map((s, i) => (
                        <tr key={`${s.externalRef}-${i}`}>
                          <td>
                            <input
                              type="checkbox"
                              checked={s.include}
                              onChange={(e) => {
                                const next = [...stories];
                                next[i] = { ...next[i], include: e.target.checked };
                                setStories(next);
                              }}
                              aria-label={`Include ${s.title}`}
                            />
                          </td>
                          <td>{s.externalRef}</td>
                          <td>
                            <input
                              className={styles.storyTitleInput}
                              value={s.title}
                              onChange={(e) => {
                                const next = [...stories];
                                next[i] = { ...next[i], title: e.target.value };
                                setStories(next);
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : null}
        </div>

        {phase === "review" ? (
          <div className={styles.footer}>
            <button type="button" className={styles.btn} onClick={() => setPhase("pick")}>
              Back
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={
                committing ||
                !epicTitle.trim() ||
                stories.filter((s) => s.include).length === 0
              }
              onClick={() => void runCommit(false)}
            >
              {committing ? "Saving…" : "Save issues"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
