import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Вход — PAI Guides' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={<div className="text-ink-500">Загрузка…</div>}>
        <LoginForm botUsername={process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? ''} />
      </Suspense>
    </main>
  );
}
