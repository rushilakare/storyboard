'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import styles from './Sidebar.module.css';

export default function Sidebar() {
  const pathname = usePathname();
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
        <Link
          href="/knowledge"
          className={`${styles.navItem} ${pathname.startsWith('/knowledge') ? styles.navItemActive : ''}`}
        >
          Knowledge base
        </Link>
        <Link
          href="/artifacts"
          className={`${styles.navItem} ${pathname === '/artifacts' || pathname.startsWith('/artifacts/') ? styles.navItemActive : ''}`}
        >
          Artifacts
        </Link>
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
