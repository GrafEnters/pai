import { Suspense } from 'react';
import { InviteRedeem } from './InviteRedeem';

export const metadata = {
  title: 'Вход по приглашению — PAI Guides',
  // Ссылку пересылают в чаты, в поиске ей делать нечего
  robots: { index: false, follow: false },
};

export default function InvitePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={<div className="text-ink-500">Загрузка…</div>}>
        <InviteRedeem />
      </Suspense>
    </main>
  );
}
