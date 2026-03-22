'use client';

import { useCallback, useEffect, useState } from 'react';
import { KnowledgeBulkUpload } from '@/components/KnowledgeBulkUpload';
import { MAX_KNOWLEDGE_TEXT_CHARS } from '@/lib/knowledge/constants';
import styles from './page.module.css';

export interface KnowledgeListItem {
  id: string;
  source_kind: 'upload' | 'text';
  filename: string;
  title: string | null;
  mime_type: string;
  byte_size: number;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  chunk_count: number;
  error_message: string | null;
  created_at: string;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function sourceLabel(row: KnowledgeListItem) {
  if (row.source_kind === 'text') return 'Text';
  if (row.mime_type === 'application/pdf') return 'PDF';
  if (row.mime_type.includes('word')) return 'DOCX';
  if (row.mime_type.startsWith('image/')) return 'Image';
  return row.mime_type.split('/').pop() || 'File';
}

function displayName(row: KnowledgeListItem) {
  return row.title?.trim() || row.filename;
}

export default function KnowledgePage() {
  const [rows, setRows] = useState<KnowledgeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [textTitle, setTextTitle] = useState('');
  const [textContent, setTextContent] = useState('');
  const [savingText, setSavingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/knowledge');
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`);
        setRows([]);
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setError('Network error while loading knowledge base.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const processing = rows.some((r) => r.status === 'processing' || r.status === 'pending');
    if (!processing) return;
    const t = setInterval(() => {
      load();
    }, 2500);
    return () => clearInterval(t);
  }, [rows, load]);

  const saveText = async () => {
    const trimmed = textContent.trim();
    if (!trimmed) {
      setTextError('Enter some text to save.');
      return;
    }
    if (trimmed.length > MAX_KNOWLEDGE_TEXT_CHARS) {
      setTextError(`Text exceeds ${MAX_KNOWLEDGE_TEXT_CHARS} characters.`);
      return;
    }
    setTextError(null);
    setSavingText(true);
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceKind: 'text',
          title: textTitle.trim() || undefined,
          content: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTextError(typeof data?.error === 'string' ? data.error : 'Save failed');
        return;
      }
      setModalOpen(false);
      setTextTitle('');
      setTextContent('');
      await load();
    } catch (e) {
      console.error(e);
      setTextError('Save failed.');
    } finally {
      setSavingText(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('Remove this item from your knowledge base? Embeddings will be deleted.')) return;
    try {
      const res = await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data?.error === 'string' ? data.error : 'Delete failed');
        return;
      }
      await load();
    } catch (e) {
      console.error(e);
      setError('Delete failed.');
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Knowledge base</h1>
        <p className={styles.subtitle}>
          Add files or pasted text as global reference material. Relevant excerpts are retrieved automatically when you
          work on features (inference, competitor, PRD). Video uploads are not supported.
        </p>
      </header>

      {error ? (
        <div className={styles.errorState} role="alert">
          {error}
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <button type="button" className={styles.btnPrimary} onClick={() => setModalOpen(true)}>
          Add text
        </button>
      </div>

      <KnowledgeBulkUpload onAfterEachUpload={load} />

      {loading ? (
        <div className={styles.emptyState}>Loading…</div>
      ) : !error && rows.length === 0 ? (
        <div className={styles.emptyState}>
          Nothing saved yet. Upload a document or add text to build your knowledge base.
        </div>
      ) : !error ? (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Source</th>
                <th>Name</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Chunks</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={styles.kindBadge}>{sourceLabel(r)}</span>
                  </td>
                  <td>{displayName(r)}</td>
                  <td className={styles.date} title={new Date(r.created_at).toLocaleString()}>
                    {timeAgo(r.created_at)}
                  </td>
                  <td>
                    <span>{r.status}</span>
                    {r.status === 'failed' && r.error_message ? (
                      <div className={styles.statusMuted}>{r.error_message.slice(0, 120)}</div>
                    ) : null}
                  </td>
                  <td>{r.status === 'ready' ? r.chunk_count : '—'}</td>
                  <td>
                    <button type="button" className={styles.btnDanger} onClick={() => remove(r.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          aria-labelledby="kb-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div className={styles.modal}>
            <div className={styles.modalHeader} id="kb-modal-title">
              Add text to knowledge base
            </div>
            <div className={styles.modalBody}>
              <div>
                <div className={styles.label}>Title (optional)</div>
                <input
                  className={styles.field}
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                  placeholder="e.g. API guidelines"
                />
              </div>
              <div>
                <div className={styles.label}>Content</div>
                <textarea
                  className={styles.textarea}
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="Paste policies, glossary, constraints, or any reference text…"
                />
                <div className={styles.charCount}>
                  {textContent.length.toLocaleString()} / {MAX_KNOWLEDGE_TEXT_CHARS.toLocaleString()}
                </div>
              </div>
              {textError ? <div className={styles.errInline}>{textError}</div> : null}
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={styles.btn} onClick={() => setModalOpen(false)} disabled={savingText}>
                Cancel
              </button>
              <button type="button" className={styles.btnPrimary} onClick={() => void saveText()} disabled={savingText}>
                {savingText ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
