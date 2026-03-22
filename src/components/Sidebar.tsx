'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';

interface RecentFeature {
  id: string;
  name: string;
  workspace_id: string;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [features, setFeatures] = useState<RecentFeature[]>([]);

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
    </aside>
  );
}
