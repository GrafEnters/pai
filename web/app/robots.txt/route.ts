// Сайт закрытый — запрещаем индексацию целиком (PLAN §5.5)
export const dynamic = 'force-static';

export function GET() {
  return new Response('User-agent: *\nDisallow: /\n', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
