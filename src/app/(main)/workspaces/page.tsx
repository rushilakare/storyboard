'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';

interface Workspace {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  features: { count: number }[];
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
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

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);

  const fetchWorkspaces = useCallback(async () => {
    setLoadError(null);
    try {
      const qs = debouncedSearch.trim()
        ? `?q=${encodeURIComponent(debouncedSearch.trim())}`
        : '';
      const res = await fetch(`/api/workspaces${qs}`);
      const data = await res.json();
      if (!res.ok) {
        const message =
          typeof data?.error === 'string' ? data.error : `Request failed (${res.status})`;
        setLoadError(message);
        setWorkspaces([]);
        return;
      }
      setWorkspaces(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch workspaces', e);
      setLoadError('Network error while loading workspaces.');
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, description: newDesc || null }),
      });
      if (res.ok) {
        setNewName('');
        setNewDesc('');
        setShowNew(false);
        fetchWorkspaces();
      }
    } catch (e) {
      console.error('Failed to create workspace', e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>All Workspaces</h1>
        <button className={styles.primaryButton} onClick={() => setShowNew(true)}>
          New Workspace
        </button>
      </header>

      {showNew && (
        <div className={styles.newWorkspaceForm}>
          <input
            className={styles.input}
            placeholder="Workspace name"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            autoFocus
          />
          <input
            className={styles.input}
            placeholder="Description (optional)"
            value={newDesc}
            onChange={e => setNewDesc(e.target.value)}
          />
          <div className={styles.formActions}>
            <button
              className={styles.primaryButton}
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button className={styles.secondaryButton} onClick={() => setShowNew(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.listSearchInput}
          placeholder="Search workspaces by name or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search workspaces"
        />
      </div>

      {loadError && (
        <div className={styles.emptyState} role="alert">
          Could not load workspaces: {loadError}
          <div style={{ marginTop: '0.75rem', opacity: 0.85, fontSize: '0.9rem' }}>
            Ensure you are signed in. In Supabase SQL Editor run{' '}
            <code>supabase/schema.sql</code>, then <code>supabase/migration-auth-iam.sql</code> (existing DBs) or{' '}
            <code>supabase/rls-policies.sql</code> (new DBs with <code>created_by</code> already in schema).
          </div>
        </div>
      )}

      {loading ? (
        <div className={styles.emptyState}>Loading workspaces...</div>
      ) : !loadError && workspaces.length === 0 ? (
        <div className={styles.emptyState}>
          {debouncedSearch.trim()
            ? 'No workspaces match your search.'
            : 'No workspaces yet. Create one to get started!'}
        </div>
      ) : !loadError ? (
        <div className={styles.grid}>
          {workspaces.map(ws => (
            <Link key={ws.id} href={`/workspaces/${ws.id}`} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.icon}>{getInitials(ws.name)}</div>
                <h2 className={styles.cardTitle}>{ws.name}</h2>
              </div>
              {ws.description && (
                <div className={styles.cardDescription}>{ws.description}</div>
              )}
              <div className={styles.cardMeta}>
                {ws.features?.[0]?.count ?? 0} features · Updated {timeAgo(ws.updated_at)}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
