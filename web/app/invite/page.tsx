import { Suspense } from 'react';
import { InviteForm } from './InviteForm';

export const metadata = { title: 'Активация доступа — PAI Guides' };

export default function InvitePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={<div className="text-ink-500">Загрузка…</div>}>
        <InviteForm />
      </Suspense>
    </main>
  );
}
