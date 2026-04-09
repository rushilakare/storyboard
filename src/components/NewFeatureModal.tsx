import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./NewFeatureModal.module.css";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function effectiveMime(file: File): string {
  const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
  let mime = file.type || "application/octet-stream";
  if (mime === "application/octet-stream" && ext === "md") mime = "text/markdown";
  if (mime === "application/octet-stream" && ext === "txt") mime = "text/plain";
  if (mime === "application/octet-stream" && ext === "pdf") mime = "application/pdf";
  if (mime === "application/octet-stream" && ext === "docx")
    mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return mime;
}

export type NewFeatureFormValues = {
  name: string;
  purpose: string;
  requirements: string;
  workspace_id: string;
  files: File[];
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
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  function addFiles(incoming: FileList | File[]) {
    setFileError(null);
    const next = [...files];
    for (const f of Array.from(incoming)) {
      if (f.size > MAX_FILE_BYTES) {
        setFileError(`${f.name} exceeds 15 MB limit`);
        continue;
      }
      const mime = effectiveMime(f);
      if (!ALLOWED_TYPES.has(mime) && !mime.startsWith("text/")) {
        setFileError(`${f.name} is not a supported file type`);
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) {
        next.push(f);
      }
    }
    setFiles(next);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId) return;
    onSubmit({ name, purpose, requirements, workspace_id: workspaceId, files });
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

          {/* File upload zone */}
          <div
            className={`${styles.uploadZone} ${isDragging ? styles.uploadZoneDragging : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
            aria-label="Attach reference files"
          >
            <span className={styles.uploadText}>
              Attach reference files — PDFs, docs, images (max 15 MB each)
            </span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.doc,.txt,.md,.csv,.html,.json,.png,.jpg,.jpeg,.webp,.gif"
              style={{ display: "none" }}
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </div>

          {files.length > 0 && (
            <ul className={styles.fileList}>
              {files.map((f, i) => (
                <li key={i} className={styles.fileItem}>
                  <span className={styles.fileName}>{f.name}</span>
                  <span className={styles.fileSize}>{formatBytes(f.size)}</span>
                  <button
                    type="button"
                    className={styles.fileRemoveBtn}
                    onClick={() => removeFile(i)}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {fileError && (
            <p className={styles.submitError} role="alert">
              {fileError}
            </p>
          )}

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
