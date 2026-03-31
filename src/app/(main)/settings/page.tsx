'use client';

import { useCallback, useEffect, useState } from 'react';
import styles from './page.module.css';

type Profile = { email: string; full_name: string };

type UsageRowAgg = {
  model_id?: string;
  source?: string;
  input: number;
  output: number;
  total: number;
  rowsWithAny: number;
  rowCount: number;
};

type UsageResponse = {
  range: { preset?: string; from: string | null; to: string | null };
  totals: UsageRowAgg;
  byModel: UsageRowAgg[];
  bySource: UsageRowAgg[];
};

function formatSource(s: string): string {
  return s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileOk, setProfileOk] = useState<string | null>(null);

  const [usageRange, setUsageRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setProfileError(null);
    setProfileOk(null);
    try {
      const res = await fetch('/api/me/profile');
      const data = await res.json();
      if (!res.ok) {
        setProfileError(typeof data?.error === 'string' ? data.error : 'Failed to load profile');
        return;
      }
      const p = data as Profile;
      setProfile(p);
      setFullName(p.full_name ?? '');
      setEmail(p.email ?? '');
    } catch {
      setProfileError('Network error loading profile');
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    setUsageError(null);
    setUsageLoading(true);
    try {
      const res = await fetch(`/api/me/usage?range=${usageRange}`);
      const data = await res.json();
      if (!res.ok) {
        setUsageError(typeof data?.error === 'string' ? data.error : 'Failed to load usage');
        setUsage(null);
        return;
      }
      setUsage(data as UsageResponse);
    } catch {
      setUsageError('Network error loading usage');
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  }, [usageRange]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileError(null);
    setProfileOk(null);
    try {
      const body: { full_name?: string; email?: string } = {};
      if ((profile?.full_name ?? '') !== fullName) body.full_name = fullName;
      if ((profile?.email ?? '') !== email) body.email = email;
      if (Object.keys(body).length === 0) {
        setProfileOk('No changes to save.');
        setProfileSaving(false);
        return;
      }
      const res = await fetch('/api/me/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileError(typeof data?.error === 'string' ? data.error : 'Save failed');
        return;
      }
      setProfile({ email: data.email ?? '', full_name: data.full_name ?? '' });
      setFullName(data.full_name ?? '');
      setEmail(data.email ?? '');
      if (data.email_pending) {
        setProfileOk('Profile updated. Check your email to confirm the new address if you changed it.');
      } else {
        setProfileOk('Profile saved.');
      }
    } catch {
      setProfileError('Network error while saving');
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Settings</h1>
      <p className={styles.subtitle}>
        Manage your account and review LLM token usage reported by the provider for this app.
      </p>

      <section className={styles.section} aria-labelledby="profile-heading">
        <h2 id="profile-heading" className={styles.sectionTitle}>
          Profile
        </h2>
        {profileLoading ? (
          <p className={styles.empty}>Loading…</p>
        ) : (
          <form onSubmit={saveProfile}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="full_name">
                Display name
              </label>
              <input
                id="full_name"
                className={styles.input}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                maxLength={200}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <p className={styles.hint}>
              Changing your email may require confirmation via a message from your auth provider
              before it takes effect.
            </p>
            <div className={styles.btnRow}>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save profile'}
              </button>
            </div>
            {profileError ? <p className={styles.error}>{profileError}</p> : null}
            {profileOk ? <p className={styles.success}>{profileOk}</p> : null}
          </form>
        )}
      </section>

      <section className={styles.section} aria-labelledby="usage-heading">
        <h2 id="usage-heading" className={styles.sectionTitle}>
          Token usage (LLM-reported)
        </h2>
        <p className={styles.hint} style={{ marginBottom: 16 }}>
          Totals are summed from completed model calls in this app. Streaming runs are counted when
          the response finishes. Some providers may omit token counts for a small share of
          requests.
        </p>
        <div className={styles.segment} role="group" aria-label="Time range">
          {(['7d', '30d', 'all'] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={usageRange === r ? styles.segmentActive : undefined}
              onClick={() => setUsageRange(r)}
            >
              {r === '7d' ? 'Last 7 days' : r === '30d' ? 'Last 30 days' : 'All time'}
            </button>
          ))}
        </div>
        {usageLoading ? (
          <p className={styles.empty}>Loading usage…</p>
        ) : usageError ? (
          <p className={styles.error}>{usageError}</p>
        ) : usage ? (
          <>
            <div className={styles.stats}>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Input tokens</div>
                <div className={styles.statValue}>{usage.totals.input.toLocaleString()}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Output tokens</div>
                <div className={styles.statValue}>{usage.totals.output.toLocaleString()}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Total tokens</div>
                <div className={styles.statValue}>{usage.totals.total.toLocaleString()}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>Events</div>
                <div className={styles.statValue}>{usage.totals.rowCount}</div>
              </div>
            </div>

            <h3 className={styles.sectionTitle} style={{ textTransform: 'none', letterSpacing: 0 }}>
              By model
            </h3>
            {usage.byModel.length === 0 ? (
              <p className={styles.empty}>No usage in this range yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Events</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byModel.map((row) => (
                      <tr key={row.model_id}>
                        <td>{row.model_id}</td>
                        <td>{row.rowCount}</td>
                        <td>{row.input.toLocaleString()}</td>
                        <td>{row.output.toLocaleString()}</td>
                        <td>{row.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <h3 className={styles.sectionTitle} style={{ textTransform: 'none', letterSpacing: 0 }}>
              By source / agent
            </h3>
            {usage.bySource.length === 0 ? (
              <p className={styles.empty}>No usage in this range yet.</p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Events</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.bySource.map((row) => (
                      <tr key={row.source}>
                        <td>{row.source ? formatSource(row.source) : '—'}</td>
                        <td>{row.rowCount}</td>
                        <td>{row.input.toLocaleString()}</td>
                        <td>{row.output.toLocaleString()}</td>
                        <td>{row.total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </section>
    </div>
  );
}
