import { env } from '../env.js';

export interface CdnProvider {
  readonly name: string;
  purgeUrls(urls: string[]): Promise<void>;
  purgeEverything(): Promise<void>;
}

/**
 * Локальный режим: покупать нечего — кэша перед нами нет. Но событие
 * записываем в лог, чтобы при выкатке было видно, что вызовы происходят
 * в правильных местах, а не «мы забыли позвать purge».
 */
const noopCdn: CdnProvider = {
  name: 'noop',
  async purgeUrls(urls) {
    console.log(`[cdn:noop] сброс кэша пропущен (${urls.length} URL): ${urls.slice(0, 5).join(', ')}`);
  },
  async purgeEverything() {
    console.log('[cdn:noop] полный сброс кэша пропущен');
  },
};

/**
 * Cloudflare Cache Purge. НАПИСАНО, НО ВЖИВУЮ НЕ ЗАПУСКАЛОСЬ — нет аккаунта.
 * Включается CDN_PROVIDER=cloudflare + CLOUDFLARE_ZONE_ID + CLOUDFLARE_API_TOKEN.
 */
const cloudflareCdn: CdnProvider = {
  name: 'cloudflare',

  async purgeUrls(urls) {
    if (!urls.length) return;
    // API принимает максимум 30 URL за раз
    for (let i = 0; i < urls.length; i += 30) {
      await call({ files: urls.slice(i, i + 30) });
    }
  },

  async purgeEverything() {
    await call({ purge_everything: true });
  },
};

async function call(body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${env.cdn.zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.cdn.apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Cloudflare purge ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
  }
}

export const cdn: CdnProvider =
  env.cdn.provider === 'cloudflare' && env.cdn.zoneId && env.cdn.apiToken ? cloudflareCdn : noopCdn;

/**
 * On-demand ревалидация Next.js (PLAN §5.3): backend дёргает web с секретом,
 * тот зовёт revalidatePath. Ошибка здесь не должна ронять публикацию —
 * страница всё равно обновится по таймеру revalidate.
 */
export async function revalidateWeb(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    const res = await fetch(`${env.webInternalUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revalidate-secret': env.revalidateSecret },
      body: JSON.stringify({ paths }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[cdn] ревалидация вернула ${res.status}: ${paths.join(', ')}`);
    }
  } catch (e) {
    console.warn(`[cdn] не достучались до web для ревалидации (${String(e)}). Страницы обновятся по таймеру.`);
  }
}

/** Полный цикл инвалидации после изменения гайда. */
export async function invalidateGuide(slug: string, categorySlug?: string | null): Promise<void> {
  const paths = ['/', `/g/${slug}`];
  if (categorySlug) paths.push(`/c/${categorySlug}`);

  await revalidateWeb(paths);
  await cdn
    .purgeUrls(paths.map((p) => `${env.publicWebUrl}${p}`))
    .catch((e) => console.warn(`[cdn] purge не удался: ${String(e)}`));
}
