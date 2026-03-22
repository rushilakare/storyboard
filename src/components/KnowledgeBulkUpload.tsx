'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  isAllowedUploadMime,
  isVideoMime,
  MAX_UPLOAD_BYTES,
  VIDEO_EXTENSIONS,
} from '@/lib/knowledge/constants';
import styles from './KnowledgeBulkUpload.module.css';

const ACCEPT =
  '.pdf,.doc,.docx,.txt,.md,.csv,.html,.json,image/png,image/jpeg,image/webp,image/gif,application/pdf';

export type KnowledgeBulkUploadItem = {
  id: string;
  file: File;
  status: 'queued' | 'uploading' | 'done' | 'error';
  loaded: number;
  total: number;
  errorMessage: string | null;
};

function extFromName(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function effectiveMime(file: File): string {
  const ext = extFromName(file.name);
  let mime = file.type || 'application/octet-stream';
  if (mime === 'application/octet-stream' && ext === 'md') mime = 'text/markdown';
  if (mime === 'application/octet-stream' && ext === 'txt') mime = 'text/plain';
  if (mime === 'application/octet-stream' && ext === 'pdf') mime = 'application/pdf';
  if (mime === 'application/octet-stream' && ext === 'docx') {
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return mime;
}

function validateClientFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'File too large (max 15 MB)';
  const ext = extFromName(file.name);
  if (VIDEO_EXTENSIONS.has(ext)) return 'Video files are not supported';
  const mime = effectiveMime(file);
  if (isVideoMime(mime)) return 'Video files are not supported';
  if (!isAllowedUploadMime(mime)) return 'Unsupported file type';
  return null;
}

function uploadKnowledgeFile(
  file: File,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => {
      xhr.abort();
    };
    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort);
    }
    xhr.open('POST', '/api/knowledge');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText) as unknown;
      } catch {
        /* empty */
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
    };
    xhr.onerror = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error('Network error'));
    };
    xhr.onabort = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const fd = new FormData();
    fd.set('file', file);
    xhr.send(fd);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  onAfterEachUpload?: () => void | Promise<void>;
  disabled?: boolean;
};

export function KnowledgeBulkUpload({ onAfterEachUpload, disabled = false }: Props) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [items, setItems] = useState<KnowledgeBulkUploadItem[]>([]);
  const [, setPumpToken] = useState(0);
  const workerBusyRef = useRef(false);
  const inflightRef = useRef<{ controller: AbortController; itemId: string } | null>(null);

  useEffect(() => {
    return () => {
      inflightRef.current?.controller.abort();
      inflightRef.current = null;
    };
  }, []);

  const clearFinished = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status !== 'done' && i.status !== 'error'));
  }, []);

  const enqueueFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (arr.length === 0) return;
    const next: KnowledgeBulkUploadItem[] = [];
    for (const file of arr) {
      const err = validateClientFile(file);
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        status: err ? 'error' : 'queued',
        loaded: 0,
        total: file.size,
        errorMessage: err,
      });
    }
    setItems((prev) => [...prev, ...next]);
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // `FileList` is live: clearing the input empties the same reference — snapshot first.
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length) enqueueFiles(picked);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const list = e.dataTransfer.files;
    if (list?.length) enqueueFiles(list);
  };

  useEffect(() => {
    if (disabled || workerBusyRef.current) return;

    const q = items.find((i) => i.status === 'queued');
    if (!q) return;

    const id = q.id;
    const file = q.file;
    workerBusyRef.current = true;

    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: 'uploading' as const, loaded: 0 } : i)),
    );

    const controller = new AbortController();
    inflightRef.current = { controller, itemId: id };

    void (async () => {
      try {
        const result = await uploadKnowledgeFile(
          file,
          (loaded, total) => {
            setItems((prev) =>
              prev.map((i) => (i.id === id ? { ...i, loaded, total: total || i.total } : i)),
            );
          },
          controller.signal,
        );

        const row = result.data as {
          error?: string;
          status?: string;
          error_message?: string | null;
        } | null;

        if (!result.ok) {
          const msg =
            typeof row?.error === 'string' ? row.error : `Upload failed (${result.status})`;
          setItems((prev) =>
            prev.map((i) => (i.id === id ? { ...i, status: 'error', errorMessage: msg } : i)),
          );
        } else if (row?.status === 'failed') {
          const msg =
            typeof row.error_message === 'string' && row.error_message.trim()
              ? row.error_message.trim()
              : 'Processing failed after upload';
          setItems((prev) =>
            prev.map((i) => (i.id === id ? { ...i, status: 'error', errorMessage: msg } : i)),
          );
          await onAfterEachUpload?.();
        } else {
          setItems((prev) =>
            prev.map((i) =>
              i.id === id ? { ...i, status: 'done', loaded: i.total, errorMessage: null } : i,
            ),
          );
          await onAfterEachUpload?.();
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          setItems((prev) =>
            prev.map((i) => (i.id === id ? { ...i, status: 'queued', loaded: 0 } : i)),
          );
        } else {
          setItems((prev) =>
            prev.map((i) =>
              i.id === id ? { ...i, status: 'error', errorMessage: 'Network error' } : i,
            ),
          );
        }
      } finally {
        if (inflightRef.current?.itemId === id) inflightRef.current = null;
        workerBusyRef.current = false;
        setPumpToken((t) => t + 1);
      }
    })();
  }, [disabled, items, onAfterEachUpload]);

  const hasPanel = items.length > 0;
  const busy = items.some((i) => i.status === 'uploading' || i.status === 'queued');
  const doneOrError = items.filter((i) => i.status === 'done' || i.status === 'error').length;

  const statusClass = (s: KnowledgeBulkUploadItem['status']) => {
    if (s === 'queued') return styles.statusQueued;
    if (s === 'uploading') return styles.statusUploading;
    if (s === 'done') return styles.statusDone;
    return styles.statusError;
  };

  const statusLabel = (i: KnowledgeBulkUploadItem) => {
    if (i.status === 'queued') return 'Queued';
    if (i.status === 'uploading') return 'Uploading';
    if (i.status === 'done') return 'Done';
    return 'Failed';
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.btn}
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Add more files…' : 'Choose files'}
        </button>
        <input
          ref={fileRef}
          id={inputId}
          type="file"
          className={styles.hiddenInput}
          accept={ACCEPT}
          multiple
          onChange={onFileChange}
        />
      </div>

      <div
        className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ''} ${disabled ? styles.dropzoneDisabled : ''}`}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragActive(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={() => !disabled && fileRef.current?.click()}
        role="presentation"
      >
        <p className={styles.dropzoneHint}>
          Drop files here or click to upload. PDF, Word, text, markdown, CSV, HTML, JSON, or images
          up to 15 MB each. Multiple files supported.
        </p>
      </div>

      {hasPanel ? (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <span>Upload queue ({items.length})</span>
            {doneOrError > 0 ? (
              <button type="button" onClick={clearFinished}>
                Clear finished
              </button>
            ) : null}
          </div>
          <ul className={styles.list} aria-live="polite">
            {items.map((i) => {
              const pct =
                i.total > 0 ? Math.min(100, Math.round((i.loaded / i.total) * 100)) : 0;
              return (
                <li key={i.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <div>
                      <div className={styles.name}>{i.file.name}</div>
                      <div className={styles.meta}>
                        {formatBytes(i.file.size)}
                        {i.status === 'uploading' ? ` · ${pct}%` : null}
                      </div>
                    </div>
                    <span className={`${styles.status} ${statusClass(i.status)}`}>
                      {statusLabel(i)}
                    </span>
                  </div>
                  {i.status === 'uploading' ? (
                    <div className={styles.barTrack} aria-hidden>
                      <div className={styles.barFill} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                  {i.status === 'error' && i.errorMessage ? (
                    <div className={styles.errDetail}>{i.errorMessage}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
