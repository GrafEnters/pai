import { revalidatePath, revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * On-demand ревалидация (PLAN §5.3): при публикации backend дёргает этот роут
 * с общим секретом, и страница пересобирается сразу, а не через час.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-revalidate-secret');
  if (!secret || secret !== (process.env.REVALIDATE_SECRET ?? 'dev-revalidate-secret')) {
    return NextResponse.json({ error: 'Неверный секрет' }, { status: 401 });
  }

  let body: { paths?: string[]; tags?: string[] };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Ожидается JSON' }, { status: 400 });
  }

  const paths = (body.paths ?? []).filter((p) => typeof p === 'string' && p.startsWith('/'));
  const tags = (body.tags ?? []).filter((t) => typeof t === 'string');

  for (const path of paths) revalidatePath(path);
  for (const tag of tags) revalidateTag(tag);
  // Данные гайдов и категорий тянутся с этими тегами — сбрасываем и их
  revalidateTag('guides');
  revalidateTag('categories');

  return NextResponse.json({ ok: true, revalidated: { paths, tags } });
}
