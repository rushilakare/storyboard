'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import Link from 'next/link';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';

interface Feature {
  id: string;
  name: string;
  status: string;
  priority: string;
  updated_at: string;
  workspace_id: string;
}

interface DashboardStats {
  workspaceCount: number;
  featureCount: number;
  prdCount: number;
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

function statusClass(status: string) {
  switch (status) {
    case 'in_progress': return styles.inProgress;
    case 'review': return styles.review;
    case 'done': return styles.done;
    default: return styles.draft;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'in_progress': return 'In Progress';
    case 'review': return 'Review';
    case 'done': return 'Done';
    default: return 'Draft';
  }
}

function priorityClass(priority: string) {
  switch (priority) {
    case 'high': return styles.priorityHigh;
    case 'low': return styles.priorityLow;
    default: return styles.priorityMedium;
  }
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    workspaceCount: 0,
    featureCount: 0,
    prdCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [featureSearch, setFeatureSearch] = useState('');
  const debouncedFeatureSearch = useDebouncedValue(featureSearch, 250);
  const [tableFeatures, setTableFeatures] = useState<Feature[]>([]);
  const [tableLoading, setTableLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [wsRes, featRes] = await Promise.all([
          fetch('/api/workspaces'),
          fetch('/api/features?limit=10'),
        ]);
        const workspaces = await wsRes.json();
        const features: Feature[] = await featRes.json();

        setStats({
          workspaceCount: Array.isArray(workspaces) ? workspaces.length : 0,
          featureCount: Array.isArray(features) ? features.length : 0,
          prdCount: Array.isArray(features)
            ? features.filter((f: Feature) => f.status === 'done' || f.status === 'review').length
            : 0,
        });
      } catch (e) {
        console.error('Dashboard load error', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    async function loadTable() {
      setTableLoading(true);
      const q = debouncedFeatureSearch.trim();
      const url = q
        ? `/api/features?q=${encodeURIComponent(q)}&limit=50`
        : '/api/features?limit=10';
      try {
        const res = await fetch(url);
        const features = (await res.json()) as Feature[];
        if (!Array.isArray(features)) {
          setTableFeatures([]);
          return;
        }
        setTableFeatures(q ? features : features.slice(0, 5));
      } catch (e) {
        console.error('Dashboard features table load error', e);
        setTableFeatures([]);
      } finally {
        setTableLoading(false);
      }
    }
    loadTable();
  }, [debouncedFeatureSearch]);

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <h1 className={styles.title}>Overview</h1>
        <Link href="/workspaces">
          <button className={styles.primaryButton}>Go to Workspaces</button>
        </Link>
      </header>

      <div className={styles.metricsContainer}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Workspaces</div>
          <div className={styles.metricValue}>{loading ? '–' : stats.workspaceCount}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Features</div>
          <div className={styles.metricValue}>{loading ? '–' : stats.featureCount}</div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>PRDs Generated</div>
          <div className={styles.metricValue}>{loading ? '–' : stats.prdCount}</div>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHeaderRow}>
          <h2 className={styles.sectionTitle}>Recent Features</h2>
          <input
            type="search"
            className={styles.listSearchInput}
            placeholder="Search features…"
            value={featureSearch}
            onChange={(e) => setFeatureSearch(e.target.value)}
            aria-label="Search features by name or description"
          />
        </div>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tableLoading ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '2rem' }}>Loading...</td>
                </tr>
              ) : tableFeatures.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '2rem', opacity: 0.5 }}>
                    {debouncedFeatureSearch.trim()
                      ? 'No matching features'
                      : 'No features yet'}
                  </td>
                </tr>
              ) : (
                tableFeatures.map(f => (
                  <tr key={f.id}>
                    <td>
                      <Link
                        href={`/workspaces/${f.workspace_id}?feature=${f.id}`}
                        className={styles.featureLink}
                      >
                        {f.name}
                      </Link>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${statusClass(f.status)}`}>
                        {statusLabel(f.status)}
                      </span>
                    </td>
                    <td>
                      <span className={priorityClass(f.priority)}>
                        {f.priority.charAt(0).toUpperCase() + f.priority.slice(1)}
                      </span>
                    </td>
                    <td className={styles.date}>{timeAgo(f.updated_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
