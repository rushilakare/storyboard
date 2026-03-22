import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import "./globals.css";
import styles from "./layout.module.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Rushi PM Tool",
  description: "A minimal, linear-inspired PM application with multi-agent intelligence.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.className}>
      <body suppressHydrationWarning>
        <div className={styles.appContainer}>
          <Sidebar />
          <main className={styles.mainContent}>{children}</main>
        </div>
      </body>
    </html>
  );
}
