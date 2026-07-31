import { NextResponse, type NextRequest } from 'next/server';

const ACCESS_COOKIE = 'pai_at';
const REFRESH_COOKIE = 'pai_rt';

/** Страницы, доступные без входа. */
const PUBLIC_PATHS = ['/login', '/invite'];

/**
 * Первый рубеж: без cookie до origin вообще не доходим (Edge Runtime, работает
 * до отдачи страницы).
 *
 * Подпись здесь НЕ проверяется намеренно: секрет JWT остаётся только у backend.
 * Настоящая проверка — на стороне API, куда идёт каждый серверный запрос за
 * данными; поддельная кука даст 401 и тот же редирект на /login.
 * На проде тот же гейт дублируется Cloudflare Worker'ом (PLAN §6.4).
 */
export function middleware(req: NextRequest) {
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

  const hasSession =
    req.cookies.has(ACCESS_COOKIE) || req.cookies.has(REFRESH_COOKIE);

  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    // Куда вернуть человека после входа
    if (pathname !== '/') url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
