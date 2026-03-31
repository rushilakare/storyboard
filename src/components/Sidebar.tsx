'use client';

import * as Popover from '@radix-ui/react-popover';
import Image from 'next/image';
import { ChevronUp, LogOut, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import GlobalSearch from '@/components/GlobalSearch';
import { createBrowserSupabaseClient } from '@/lib/supabase/browser';
import styles from './Sidebar.module.css';

function displayLabel(user: User | null): string {
  if (!user) return 'Account';
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const full =
    typeof meta?.full_name === 'string' && meta.full_name.trim()
      ? meta.full_name.trim()
      : typeof meta?.name === 'string' && meta.name.trim()
        ? meta.name.trim()
        : '';
  if (full) return full;
  const em = user.email?.split('@')[0] ?? '';
  return em || 'Account';
}

function initials(user: User | null): string {
  const label = displayLabel(user);
  if (label === 'Account') return '?';
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return label.slice(0, 2).toUpperCase();
}

export default function Sidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const label = useMemo(() => displayLabel(user), [user]);
  const av = useMemo(() => initials(user), [user]);

  return (
    <aside className={styles.sidebar}>
      <Link href="/workspaces" className={styles.logo}>
        <Image
          src="/speqtr-logo-light.svg"
          alt="Speqtr"
          width={400}
          height={90}
          className={styles.logoImage}
          priority
        />
      </Link>

      <GlobalSearch />

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
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={styles.profileTrigger}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
            >
              <span className={styles.avatar} aria-hidden>
                {av}
              </span>
              <span className={styles.profileText}>
                <span className={styles.profileName}>{label}</span>
              </span>
              <ChevronUp className={styles.profileChevron} size={16} aria-hidden />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className={styles.popoverContent}
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={16}
            >
              {user?.email ? (
                <div className={styles.popoverEmail} title={user.email}>
                  {user.email}
                </div>
              ) : null}
              <div className={styles.popoverDivider} />
              <Link
                href="/settings"
                className={styles.popoverItem}
                onClick={() => setMenuOpen(false)}
              >
                <Settings size={16} aria-hidden />
                <span>Settings</span>
              </Link>
              <form action="/auth/sign-out" method="post" className={styles.popoverSignOutForm}>
                <button type="submit" className={styles.popoverItem}>
                  <LogOut size={16} aria-hidden />
                  <span>Log out</span>
                </button>
              </form>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </aside>
  );
}
