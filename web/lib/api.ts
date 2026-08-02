import { cookies } from 'next/headers';

/**
 * Server Components ходят в backend напрямую (внутри docker-сети), браузер —
 * по публичному адресу. Отсюда две базы.
 */
export const API_INTERNAL = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001'
).replace(/\/+$/, '');

export { API_PUBLIC } from './config';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Запрос к API из Server Component с пробросом cookie пользователя.
 * `cache: 'no-store'` по умолчанию — персональные данные кэшировать нельзя;
 * для контента, который одинаков для всех, передавайте `revalidate`.
 */
export async function serverFetch<T>(
  path: string,
  opts: { revalidate?: number; tags?: string[]; method?: string; body?: unknown } = {},
): Promise<T> {
  const cookieHeader = (await cookies()).toString();

  const res = await fetch(`${API_INTERNAL}/api${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      cookie: cookieHeader,
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    ...(opts.revalidate !== undefined
      ? { next: { revalidate: opts.revalidate, tags: opts.tags } }
      : { cache: 'no-store' as const }),
  });

  if (!res.ok) {
    let message = `Ошибка API ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* тело не JSON — оставляем общее сообщение */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

/**
 * Публичный (не персональный) контент: кэшируется ISR, cookie НЕ пробрасывается.
 * Именно так тянутся гайды и категории — иначе кэш стал бы персональным.
 */
export async function publicFetch<T>(path: string, revalidate = 3600, tags?: string[]): Promise<T> {
  const res = await fetch(`${API_INTERNAL}/api${path}`, {
    headers: { 'x-internal-token': process.env.REVALIDATE_SECRET ?? '' },
    next: { revalidate, tags },
  });
  if (!res.ok) throw new ApiError(res.status, `Ошибка API ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Me {
  id: number;
  name: string;
  login: string | null;
  role: 'NONE' | 'VIEWER' | 'EDITOR' | 'ADMIN';
  teamRole: 'BUYER' | 'FARMER' | 'TECH' | 'MEDIABUYER' | 'MANAGER' | 'OTHER';
  email: string | null;
  /** Задан ли пароль. У пришедших по пригласительной ссылке его нет */
  hasPassword: boolean;
  telegramUsername: string | null;
  isActive: boolean;
}

/** Текущий пользователь или null, если кука невалидна. */
export async function getMe(): Promise<Me | null> {
  try {
    return await serverFetch<Me>('/auth/me');
  } catch {
    return null;
  }
}
