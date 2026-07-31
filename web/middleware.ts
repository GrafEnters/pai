import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const ACCESS_COOKIE = 'pai_at';
const REFRESH_COOKIE = 'pai_rt';

/** Страницы, доступные без входа. */
const PUBLIC_PATHS = ['/login', '/invite'];

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me-please-32-chars-min');

/**
 * Гейт доступа до отдачи страницы (Edge Runtime).
 *
 * Подпись access-токена проверяется здесь по-настоящему — иначе кэш ISR отдавал
 * бы готовый HTML гайда любому, кто просто поставил себе куку с этим именем.
 * Ровно та же логика на проде живёт в Cloudflare Worker (PLAN §6.4).
 *
 * Если access истёк, но refresh есть — пропускаем на страницу: там клиентский код
 * обновит пару токенов. Иначе человека выкидывало бы на /login каждые 15 минут.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/') ||
    pathname === '/robots.txt' ||
    pathname === '/favicon.ico' ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next();
  }

  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  if (access) {
    try {
      await jwtVerify(access, secret);
      return NextResponse.next();
    } catch {
      // истёк или подделан — падаем ниже, к refresh
    }
  }

  if (req.cookies.get(REFRESH_COOKIE)?.value) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  if (pathname !== '/') url.searchParams.set('next', pathname + search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
