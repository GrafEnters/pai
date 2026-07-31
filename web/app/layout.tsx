import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PAI Guides — база знаний команды',
  description: 'Внутренняя база знаний',
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
