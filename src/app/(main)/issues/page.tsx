'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import IssueDetailLayout from '@/components/issues/IssueDetailLayout';
import type { FeatureIssue } from '@/lib/database.types';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import styles from './page.module.css';

interface IssueRow {
  id: string;
  feature_id: string;
  parent_id: string | null;
  type: string;
  issue_key: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
  status: string;
  priority: string;
  due_date: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  feature_name: string;
  workspace_id: string;
  workspace_name: string;
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

function normalizeIssue(row: FeatureIssue): FeatureIssue {
  return {
    ...row,
    due_date: row.due_date ?? null,
    generated_from: row.generated_from ?? null,
  };
}

export default function IssuesPage() {
  const [rows, setRows] = useState<IssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [selected, setSelected] = useState<IssueRow | null>(null);
  const [treeEpic, setTreeEpic] = useState<FeatureIssue | null>(null);
  const [treeStories, setTreeStories] = useState<FeatureIssue[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/issues');
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : 'Failed to load');
        setRows([]);
        return;
      }
      setRows(Array.isArray(data.issues) ? data.issues : []);
    } catch {
      setError('Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setTreeEpic(null);
      setTreeStories([]);
      return;
    }
    let cancelled = false;
    setTreeLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/features/${selected.feature_id}/issues`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setTreeEpic(null);
          setTreeStories([]);
          return;
        }
        const e = data.epic ? normalizeIssue(data.epic as FeatureIssue) : null;
        const s = Array.isArray(data.stories)
          ? (data.stories as FeatureIssue[]).map(normalizeIssue)
          : [];
        setTreeEpic(e);
        setTreeStories(s);
      } catch {
        if (!cancelled) {
          setTreeEpic(null);
          setTreeStories([]);
        }
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const issueMap = useMemo(() => {
    const m = new Map<string, FeatureIssue>();
    if (treeEpic) m.set(treeEpic.id, treeEpic);
    for (const s of treeStories) m.set(s.id, s);
    return m;
  }, [treeEpic, treeStories]);

  const detailIssue = useMemo(() => {
    if (!selected) return null;
    return issueMap.get(selected.id) ?? null;
  }, [selected, issueMap]);

  const parentEpic = useMemo(() => {
    if (!detailIssue || detailIssue.type !== 'story' || !detailIssue.parent_id) return null;
    return issueMap.get(detailIssue.parent_id) ?? null;
  }, [detailIssue, issueMap]);

  const childStories = useMemo(() => {
    if (!detailIssue || detailIssue.type !== 'epic' || !treeEpic) return [];
    return treeStories
      .filter((s) => s.parent_id === treeEpic.id)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [detailIssue, treeEpic, treeStories]);

  const workspaceOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      m.set(r.workspace_id, r.workspace_name);
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (workspaceFilter && r.workspace_id !== workspaceFilter) return false;
      if (!q) return true;
      return `${r.title} ${r.issue_key} ${r.feature_name} ${r.workspace_name} ${r.type}`
        .toLowerCase()
        .includes(q);
    });
  }, [rows, debouncedSearch, workspaceFilter]);

  const patchSelected = useCallback(
    async (patch: {
      status?: FeatureIssue['status'];
      priority?: FeatureIssue['priority'];
      due_date?: string | null;
    }) => {
      if (!selected) return;
      const res = await fetch(`/api/features/${selected.feature_id}/issues/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return;
      const updated = normalizeIssue((await res.json()) as FeatureIssue);
      setRows((prev) =>
        prev.map((r) =>
          r.id === updated.id
            ? {
                ...r,
                status: updated.status,
                priority: updated.priority,
                due_date: updated.due_date,
                title: updated.title,
                description: updated.description,
                acceptance_criteria: updated.acceptance_criteria,
                updated_at: updated.updated_at,
              }
            : r,
        ),
      );
      setSelected((prev) =>
        prev && prev.id === updated.id
          ? {
              ...prev,
              status: updated.status,
              priority: updated.priority,
              due_date: updated.due_date,
              title: updated.title,
              description: updated.description,
              acceptance_criteria: updated.acceptance_criteria,
              updated_at: updated.updated_at,
            }
          : prev,
      );
      if (updated.type === 'epic') {
        setTreeEpic(updated);
      } else {
        setTreeStories((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      }
    },
    [selected],
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Issues</h1>
        <p className={styles.subtitle}>
          Epics and stories across your workspaces. Generate them from feature inference and competitor
          analysis in the feature workspace.
        </p>
      </header>

      <div className={styles.filters}>
        <input
          type="search"
          className={styles.input}
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search issues"
        />
        <select
          className={styles.select}
          value={workspaceFilter}
          onChange={(e) => setWorkspaceFilter(e.target.value)}
          aria-label="Filter by workspace"
        >
          <option value="">All workspaces</option>
          {workspaceOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className={styles.empty} role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className={styles.empty}>Loading issues…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {debouncedSearch.trim() || workspaceFilter
            ? 'No issues match your filters.'
            : 'No issues yet. Open a feature, use the Issues panel, and generate backlog from inference and competitor work.'}
        </div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Key</th>
                <th>Type</th>
                <th>Title</th>
                <th>Status</th>
                <th>Workspace</th>
                <th>Feature</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className={styles.rowClick}
                  onClick={() => setSelected(r)}
                >
                  <td>{r.issue_key}</td>
                  <td>
                    <span className={styles.badge}>{r.type}</span>
                  </td>
                  <td>{r.title}</td>
                  <td className={styles.muted}>{r.status.replace(/_/g, ' ')}</td>
                  <td>{r.workspace_name}</td>
                  <td>
                    <Link
                      href={`/workspaces/${r.workspace_id}?feature=${r.feature_id}`}
                      className={styles.link}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.feature_name}
                    </Link>
                  </td>
                  <td className={styles.muted}>{timeAgo(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (treeLoading || detailIssue) ? (
        <div
          className={styles.drawerOverlay}
          role="presentation"
          onClick={() => setSelected(null)}
        >
          <aside
            className={styles.drawerPanelWide}
            role="dialog"
            aria-label="Issue detail"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.drawerHeader}>
              <div className={styles.drawerHeaderText}>
                <div className={styles.drawerMeta}>
                  {selected.issue_key} · {selected.type} · {selected.workspace_name}
                </div>
              </div>
              <button
                type="button"
                className={styles.drawerClose}
                aria-label="Close"
                onClick={() => setSelected(null)}
              >
                <X size={20} strokeWidth={2} aria-hidden />
              </button>
            </div>
            <div className={styles.drawerBodyWide}>
              {treeLoading || !detailIssue ? (
                <div className={styles.empty}>Loading detail…</div>
              ) : (
                <IssueDetailLayout
                  workspaceId={selected.workspace_id}
                  workspaceName={selected.workspace_name}
                  featureName={selected.feature_name}
                  featureId={selected.feature_id}
                  issue={detailIssue}
                  parentEpic={parentEpic}
                  childStories={childStories}
                  onSelectIssue={(id) => {
                    const hit = rows.find((x) => x.id === id);
                    if (hit) setSelected(hit);
                  }}
                  onPatch={patchSelected}
                />
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
