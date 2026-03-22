'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import styles from './Sidebar.module.css';

interface RecentFeature {
  id: string;
  name: string;
  workspace_id: string;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [features, setFeatures] = useState<RecentFeature[]>([]);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/features?limit=5');
        const data = await res.json();
        if (Array.isArray(data)) setFeatures(data);
      } catch {
        // silent fail for sidebar
      }
    }
    load();
  }, []);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}></div>
        Rushi PM
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Views</div>
        <Link
          href="/"
          className={`${styles.navItem} ${pathname === '/' ? styles.navItemActive : ''}`}
        >
          Dashboard
        </Link>
        <Link
          href="/workspaces"
          className={`${styles.navItem} ${pathname.startsWith('/workspaces') ? styles.navItemActive : ''}`}
        >
          Workspaces
        </Link>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Recent Features</div>
        {features.length === 0 ? (
          <div className={styles.navItem} style={{ opacity: 0.5 }}>
            No features yet
          </div>
        ) : (
          features.map(f => (
            <Link
              key={f.id}
              href={`/workspaces/${f.workspace_id}?feature=${f.id}`}
              className={styles.navItem}
            >
              {f.name}
            </Link>
          ))
        )}
      </div>

      <div className={styles.footer}>
        {email ? (
          <div className={styles.userEmail} title={email}>
            {email}
          </div>
        ) : null}
        <form action="/auth/sign-out" method="post">
          <button type="submit" className={styles.signOut}>
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
