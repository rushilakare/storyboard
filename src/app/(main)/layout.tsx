import Sidebar from '@/components/Sidebar';
import styles from './layout.module.css';

export default function MainShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className={styles.appContainer}>
      <Sidebar />
      <main className={styles.mainContent}>{children}</main>
    </div>
  );
}
