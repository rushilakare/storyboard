'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { ArtifactListExportSplitButton } from '@/components/DocumentExportSplitButton';

export interface ArtifactListItem {
  id: string;
  feature_id: string;
  kind: string;
  title: string | null;
  version: number;
  updated_at: string;
  created_at: string;
  feature_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
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

function kindLabel(kind: string) {
  switch (kind) {
    case 'prd':
      return 'PRD';
    case 'inference':
      return 'Inference';
    default:
      return kind;
  }
}

export default function ArtifactsPage() {
  const [rows, setRows] = useState<ArtifactListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = debouncedSearch.trim()
        ? `?q=${encodeURIComponent(debouncedSearch.trim())}`
        : '';
      const res = await fetch(`/api/artifacts${qs}`);
      const data = await res.json();
      if (!res.ok) {
        const message =
          typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
        setError(message);
        setRows([]);
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Artifacts load error', e);
      setError('Network error while loading artifacts.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Artifacts</h1>
      </header>

      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.listSearchInput}
          placeholder="Search by title, kind, feature, or workspace…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search artifacts"
        />
      </div>

      {error ? (
        <div className={styles.errorState} role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className={styles.emptyState}>Loading artifacts…</div>
      ) : !error && rows.length === 0 ? (
        <div className={styles.emptyState}>
          {debouncedSearch.trim()
            ? 'No artifacts match your search.'
            : 'No artifacts yet. Run inference or generate a PRD on a feature.'}
        </div>
      ) : !error ? (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Title</th>
                <th>Feature</th>
                <th>Workspace</th>
                <th>Updated</th>
                <th className={styles.actionsCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const wsId = r.workspace_id ?? '';
                const href =
                  wsId && r.feature_id
                    ? `/workspaces/${wsId}?feature=${r.feature_id}`
                    : '#';
                return (
                  <tr key={r.id}>
                    <td>
                      <span className={styles.kindBadge}>{kindLabel(r.kind)}</span>
                      {r.version > 1 ? (
                        <span className={styles.workspaceMuted}> v{r.version}</span>
                      ) : null}
                    </td>
                    <td>{r.title ?? '—'}</td>
                    <td>
                      {wsId && r.feature_id ? (
                        <Link href={href} className={styles.featureLink}>
                          {r.feature_name ?? r.feature_id}
                        </Link>
                      ) : (
                        (r.feature_name ?? r.feature_id ?? '—')
                      )}
                    </td>
                    <td>
                      {wsId ? (
                        <Link href={`/workspaces/${wsId}?view=artifacts`} className={styles.workspaceLink}>
                          {r.workspace_name ?? wsId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={styles.date}>{timeAgo(r.updated_at)}</td>
                    <td className={styles.actionsCell}>
                      {r.feature_id ? (
                        <ArtifactListExportSplitButton
                          featureId={r.feature_id}
                          artifactId={r.id}
                          kind={r.kind}
                          title={r.title}
                          version={r.version}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
