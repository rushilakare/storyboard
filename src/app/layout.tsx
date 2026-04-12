import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, Libre_Bodoni } from 'next/font/google';
import './globals.css';
import { cn } from "@/lib/utils";

const jakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const libreBodoni = Libre_Bodoni({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

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
      className={cn(jakartaSans.variable, libreBodoni.variable, 'font-sans antialiased')}
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
