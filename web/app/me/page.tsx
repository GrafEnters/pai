import { redirect } from 'next/navigation';
import { getMe, publicFetch, serverFetch } from '@/lib/api';
import type { CategoryNode, GuideCard } from '@/lib/types';
import { TEAM_ROLE_LABEL, readingTimeLabel } from '@/lib/types';
import { EmptyState, GuideCardView, Header } from '@/components/Shell';

export const metadata = { title: 'Мой прогресс — PAI Guides', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

interface ProgressRow {
  guide: GuideCard;
  firstOpenedAt: string;
  lastOpenedAt: string;
  readAt: string | null;
  activeSec: number;
}

export default async function MePage() {
  const me = await getMe();
  if (!me) redirect('/login?next=/me');

  const [categories, required, progress] = await Promise.all([
    publicFetch<CategoryNode[]>('/categories', 3600, ['categories']),
    serverFetch<GuideCard[]>('/guides/required/mine').catch(() => []),
    serverFetch<ProgressRow[]>('/me/progress').catch(() => []),
  ]);

  const notRead = required.filter((g) => !g.readAt);
  const readCount = progress.filter((p) => p.readAt).length;
  const totalActiveMin = Math.round(progress.reduce((sum, p) => sum + p.activeSec, 0) / 60);

  return (
    <>
      <Header me={me} categories={categories} />

      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-white">{me.name}</h1>
        <p className="mt-1 text-sm text-ink-500">
          {TEAM_ROLE_LABEL[me.teamRole]} · {me.login ?? me.email ?? ''}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Прочитано" value={String(readCount)} />
          <Stat label="Открыто гайдов" value={String(progress.length)} />
          <Stat label="Времени за чтением" value={`${totalActiveMin} мин`} />
          <Stat
            label="Обязательных осталось"
            value={String(notRead.length)}
            accent={notRead.length ? 'text-amber-400' : 'text-green-400'}
          />
        </div>

        {required.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-semibold text-white">Обязательное для вашей роли</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {required.map((g) => (
                <GuideCardView key={g.id} guide={g} showStatus />
              ))}
            </div>
          </section>
        )}

        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold text-white">Продолжить чтение</h2>
          {progress.length ? (
            <div className="divide-y divide-ink-800 rounded-xl border border-ink-800">
              {progress.slice(0, 20).map((p) => (
                <a
                  key={p.guide.id}
                  href={`/g/${p.guide.slug}`}
                  className="flex items-center gap-3 p-3 transition-colors hover:bg-ink-900"
                >
                  <span className="flex-1">
                    <span className="block text-ink-200">{p.guide.title}</span>
                    <span className="text-xs text-ink-600">
                      {p.guide.category.title} · {readingTimeLabel(p.guide.readingTimeSec)} ·{' '}
                      {new Date(p.lastOpenedAt).toLocaleDateString('ru')}
                    </span>
                  </span>
                  <span className={`text-xs ${p.readAt ? 'text-green-400' : 'text-amber-400'}`}>
                    {p.readAt ? 'прочитано' : 'в процессе'}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <EmptyState title="Вы ещё ничего не открывали" hint="Начните с раздела «Онбординг»" />
          )}
        </section>
      </main>
    </>
  );
}

function Stat({ label, value, accent = 'text-white' }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900 p-4">
      <div className={`text-2xl font-semibold ${accent}`}>{value}</div>
      <div className="mt-0.5 text-xs text-ink-500">{label}</div>
    </div>
  );
}
