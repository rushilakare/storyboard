import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const viewport: Viewport = {
  colorScheme: 'light',
};

export const metadata: Metadata = {
  title: 'Speqtr',
  description:
    'Speqtr — a linear-inspired PM workspace with multi-agent intelligence for features and PRDs.',
  icons: { icon: '/speqtr-logo.svg' },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn(geist.variable, geist.className, 'font-sans antialiased')}
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
