'use client';

import Link from 'next/link';
import { useMe } from '@/lib/useMe';
import { LogoutButton } from './LogoutButton';

/**
 * Правый угол шапки: имя и «Выйти» — своим, «Войти» — гостю.
 *
 * Гость на сайте появляется только при открытом публичном доступе (тумблер в
 * админке). Кнопка выхода ему не нужна, а вход предложить стоит: под ним есть
 * прогресс, обязательные гайды и отметка «полезно».
 */
export function CurrentUser() {
  const { me, checked } = useMe();

  if (checked && !me) {
    return (
      <Link href="/login" className="rounded-md px-2 py-1.5 text-sm text-ink-400 transition-colors hover:bg-ink-900 hover:text-ink-200">
        Войти
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/me"
        className="hidden max-w-[10rem] truncate text-sm text-ink-400 hover:text-ink-200 sm:block"
        // Пока имя не приехало, место под него уже занято — вёрстка не прыгает
        style={{ minWidth: '4rem' }}
      >
        {me?.name ?? ''}
      </Link>
      {me && <LogoutButton />}
    </>
  );
}
