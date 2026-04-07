import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "./NewFeatureModal.module.css";

export type NewFeatureFormValues = {
  name: string;
  purpose: string;
  requirements: string;
  workspace_id: string;
};

interface NewFeatureModalProps {
  onClose: () => void;
  onSubmit: (data: NewFeatureFormValues) => void;
  submitError?: string | null;
  workspaces: { id: string; name: string }[];
  workspacesLoading?: boolean;
  /** When set and present in `workspaces`, that row is selected; otherwise first workspace is used. */
  defaultWorkspaceId?: string | null;
}

export default function NewFeatureModal({
  onClose,
  onSubmit,
  submitError,
  workspaces,
  workspacesLoading = false,
  defaultWorkspaceId = null,
}: NewFeatureModalProps) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [requirements, setRequirements] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");

  useEffect(() => {
    if (workspaces.length === 0) {
      setWorkspaceId("");
      return;
    }
    const preferred =
      defaultWorkspaceId && workspaces.some((w) => w.id === defaultWorkspaceId)
        ? defaultWorkspaceId
        : workspaces[0].id;
    setWorkspaceId(preferred);
  }, [defaultWorkspaceId, workspaces]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    onSubmit({ name, purpose, requirements, workspace_id: workspaceId });
  };

  const noWorkspaces = !workspacesLoading && workspaces.length === 0;

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2 className={styles.title}>New Feature Request</h2>
        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Feature Name</label>
            <input
              className={styles.input}
              placeholder="e.g. Advanced Filtering"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="new-feature-workspace">
              Workspace
            </label>
            {workspacesLoading ? (
              <p className={styles.workspacesHint}>Loading workspaces…</p>
            ) : noWorkspaces ? (
              <p className={styles.workspacesHint}>
                You need a workspace before creating a feature.{" "}
                <Link href="/workspaces" onClick={onClose}>
                  Create or open a workspace
                </Link>
                .
              </p>
            ) : (
              <select
                id="new-feature-workspace"
                className={styles.select}
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
                required
                aria-label="Workspace for this feature"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>Purpose</label>
            <textarea
              className={styles.textarea}
              placeholder="Why do we need this?"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Requirements</label>
            <textarea
              className={styles.textarea}
              placeholder="List specific requirements or edge cases…"
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
            />
          </div>

          <div className={styles.uploadZone} aria-disabled="true" title="Coming soon">
            <span className={styles.uploadText}>
              File uploads are not available yet. Add context in Requirements or use the Knowledge page.
            </span>
          </div>

          {submitError ? (
            <p className={styles.submitError} role="alert">
              {submitError}
            </p>
          ) : null}

          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={workspacesLoading || noWorkspaces || !workspaceId}
            >
              Start
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
