'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import styles from './GlobalSearch.module.css';

function shortcutLabel() {
  if (typeof navigator === 'undefined') return '⌘K';
  return /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl+K';
}

type SearchResponse = {
  query: string;
  workspaces: Array<{
    id: string;
    name: string;
    description: string | null;
    href: string;
  }>;
  features: Array<{
    id: string;
    name: string;
    workspace_id: string;
    status: string;
    href: string;
  }>;
  knowledge: Array<{
    id: string;
    filename: string;
    title: string | null;
    status: string;
    href: string;
  }>;
  artifacts: Array<{
    id: string;
    feature_id: string;
    title: string | null;
    kind: string;
    workspace_id: string | null;
    feature_name: string | null;
    workspace_name: string | null;
    href: string;
  }>;
};

const emptyResponse: SearchResponse = {
  query: '',
  workspaces: [],
  features: [],
  knowledge: [],
  artifacts: [],
};

export default function GlobalSearch() {
  const [modK, setModK] = useState('⌘K');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 250);
  const [result, setResult] = useState<SearchResponse>(emptyResponse);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResult(emptyResponse);
  }, []);

  useEffect(() => {
    setModK(shortcutLabel());
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const q = debouncedQuery.trim();
    if (!q) {
      setResult(emptyResponse);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as SearchResponse & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setResult(emptyResponse);
          return;
        }
        setResult({
          query: typeof data.query === 'string' ? data.query : q,
          workspaces: Array.isArray(data.workspaces) ? data.workspaces : [],
          features: Array.isArray(data.features) ? data.features : [],
          knowledge: Array.isArray(data.knowledge) ? data.knowledge : [],
          artifacts: Array.isArray(data.artifacts) ? data.artifacts : [],
        });
      } catch {
        if (!cancelled) setResult(emptyResponse);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, debouncedQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const hasResults =
    result.workspaces.length > 0 ||
    result.features.length > 0 ||
    result.knowledge.length > 0 ||
    result.artifacts.length > 0;

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>Search…</span>
        <kbd className={styles.kbd}>{modK}</kbd>
      </button>

      {open ? (
        <div
          className={styles.overlay}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className={styles.panel}
            role="dialog"
            aria-label="Global search"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={styles.searchField}>
              <input
                ref={inputRef}
                type="search"
                className={styles.input}
                placeholder="Workspaces, features, knowledge, artifacts…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search"
              />
            </div>

            <div className={styles.results}>
              {loading ? (
                <div className={styles.muted}>Searching…</div>
              ) : !debouncedQuery.trim() ? (
                <div className={styles.muted}>Type to search list metadata across the app.</div>
              ) : !hasResults ? (
                <div className={styles.muted}>No results.</div>
              ) : (
                <>
                  {result.workspaces.length > 0 ? (
                    <>
                      <p className={styles.groupTitle}>Workspaces</p>
                      {result.workspaces.map((w) => (
                        <Link
                          key={w.id}
                          href={w.href}
                          className={styles.resultLink}
                          onClick={close}
                        >
                          <div className={styles.resultTitle}>{w.name}</div>
                          {w.description ? (
                            <div className={styles.resultSub}>{w.description.slice(0, 120)}</div>
                          ) : null}
                        </Link>
                      ))}
                    </>
                  ) : null}

                  {result.features.length > 0 ? (
                    <>
                      <p className={styles.groupTitle}>Features</p>
                      {result.features.map((f) => (
                        <Link
                          key={f.id}
                          href={f.href}
                          className={styles.resultLink}
                          onClick={close}
                        >
                          <div className={styles.resultTitle}>{f.name}</div>
                          <div className={styles.resultSub}>{f.status}</div>
                        </Link>
                      ))}
                    </>
                  ) : null}

                  {result.knowledge.length > 0 ? (
                    <>
                      <p className={styles.groupTitle}>Knowledge</p>
                      {result.knowledge.map((k) => (
                        <Link
                          key={k.id}
                          href={k.href}
                          className={styles.resultLink}
                          onClick={close}
                        >
                          <div className={styles.resultTitle}>
                            {k.title?.trim() || k.filename}
                          </div>
                          <div className={styles.resultSub}>
                            {k.status} · {k.filename}
                          </div>
                        </Link>
                      ))}
                    </>
                  ) : null}

                  {result.artifacts.length > 0 ? (
                    <>
                      <p className={styles.groupTitle}>Artifacts</p>
                      {result.artifacts.map((a) => (
                        <Link
                          key={a.id}
                          href={a.href}
                          className={styles.resultLink}
                          onClick={close}
                        >
                          <div className={styles.resultTitle}>{a.title ?? a.kind}</div>
                          <div className={styles.resultSub}>
                            {[a.workspace_name, a.feature_name].filter(Boolean).join(' · ')}
                          </div>
                        </Link>
                      ))}
                    </>
                  ) : null}
                </>
              )}
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.closeBtn} onClick={close}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
