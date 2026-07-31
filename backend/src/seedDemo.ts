/**
 * Демо-контент для показа системы и проверки дашборда.
 *   npm run seed:demo        — создать
 *   npm run seed:demo wipe   — удалить всё созданное этим скриптом
 *
 * Все демо-гайды помечены тегом `demo`, поэтому удаляются точно и не заденут
 * настоящий контент.
 */
import { prisma } from './db.js';
import { env } from './env.js';
import { EMPTY_DOC, slugify, type TipTapDoc } from './content/schema.js';
import { deriveContent, syncGuideMedia } from './services/guides.js';
import { revalidateWeb } from './services/cdn.js';

const DEMO_TAG = 'demo';

interface DemoGuide {
  title: string;
  summary: string;
  category: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  requiredForRoles?: ('BUYER' | 'FARMER' | 'TECH' | 'MEDIABUYER' | 'MANAGER' | 'OTHER')[];
  doc: TipTapDoc;
}

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const callout = (variant: string, title: string, text: string) => ({
  type: 'callout',
  attrs: { variant, title },
  content: [p(text)],
});
const checklist = (items: string[]) => ({
  type: 'checklist',
  attrs: {
    persistKey: 'main',
    items: items.map((text, i) => ({ id: `i${i}`, text })),
  },
});
const steps = (items: [string, string][]) => ({
  type: 'steps',
  content: items.map(([title, body]) => ({ type: 'step', attrs: { title }, content: [p(body)] })),
});

const DEMO: DemoGuide[] = [
  {
    title: 'Онбординг: первая неделя',
    summary: 'Что сделать в первые семь дней, чтобы не тормозить команду.',
    category: 'onboarding',
    level: 'BEGINNER',
    requiredForRoles: ['BUYER', 'FARMER', 'TECH', 'MEDIABUYER', 'MANAGER', 'OTHER'],
    doc: {
      type: 'doc',
      content: [
        h(2, 'Зачем это читать'),
        p('Это первый гайд, который открывает каждый новый человек. Он короткий и по делу.'),
        checklist([
          'Получить доступы в менеджере паролей',
          'Прочитать гайды, отмеченные как обязательные для вашей роли',
          'Зайти в рабочие чаты и представиться',
          'Поставить рабочее окружение по гайду «Прокси: настройка»',
        ]),
        callout('info', 'Где спрашивать', 'Если что-то непонятно — сначала поиск по базе, потом чат команды.'),
      ],
    },
  },
  {
    title: 'Facebook: антибан на старте',
    summary: 'Почему аккаунты улетают в первые часы и что с этим делать.',
    category: 'facebook',
    level: 'INTERMEDIATE',
    requiredForRoles: ['BUYER', 'MEDIABUYER'],
    doc: {
      type: 'doc',
      content: [
        h(2, 'Главные причины бана'),
        p('Почти все ранние баны объясняются тремя вещами: холодный аккаунт, резкий бюджет и грязный прокси.'),
        steps([
          ['Прогрев', 'Минимум трое суток обычной активности до первого запуска.'],
          ['Бюджет', 'Стартуем с минимального и поднимаем не больше чем на 20% в сутки.'],
          ['Прокси', 'Один аккаунт — один IP. Проверяем на утечку WebRTC перед стартом.'],
        ]),
        callout('danger', 'Не делайте так', 'Не заходите в аккаунт с домашнего IP «только посмотреть» — этого достаточно для связки.'),
        h(3, 'Что проверить перед запуском'),
        checklist(['Прокси отвечает и не течёт', 'Аккаунт прогрет ≥ 3 суток', 'Платёжка прошла тестовое списание']),
      ],
    },
  },
  {
    title: 'Прокси: выбор и диагностика',
    summary: 'Как выбрать прокси и быстро понять, что он виноват.',
    category: 'proxy',
    level: 'BEGINNER',
    requiredForRoles: ['TECH'],
    doc: {
      type: 'doc',
      content: [
        h(2, 'Что берём'),
        p('Мобильные — для фарма, резидентские — для работы, датацентровые — только под задачи, где гео не важно.'),
        h(2, 'Быстрая диагностика'),
        steps([
          ['Пинг', 'Больше 250 мс до нужного гео — меняем.'],
          ['Утечки', 'Проверяем WebRTC и DNS.'],
          ['Чистота', 'Смотрим, не в блэклистах ли IP.'],
        ]),
      ],
    },
  },
  {
    title: 'TikTok: модерация креативов',
    summary: 'Что заворачивают чаще всего и как переделать.',
    category: 'tiktok',
    level: 'ADVANCED',
    doc: {
      type: 'doc',
      content: [
        h(2, 'Частые отказы'),
        p('Обещания результата, медицинская тематика, чужие товарные знаки в кадре.'),
        callout('warn', 'Внимание', 'Повторная подача одного и того же креатива без правок ухудшает репутацию кабинета.'),
      ],
    },
  },
  {
    title: 'Платёжки: что делать при отказе',
    summary: 'Пошагово, когда карта не привязывается.',
    category: 'payments',
    level: 'INTERMEDIATE',
    doc: {
      type: 'doc',
      content: [
        h(2, 'Порядок действий'),
        steps([
          ['Проверить лимит', 'Часто дело просто в дневном лимите карты.'],
          ['Сменить гео', 'Гео карты и гео аккаунта должны совпадать.'],
          ['Пробное списание', 'Один доллар — если прошёл, привязка тоже пройдёт.'],
        ]),
        checklist(['Лимит проверен', 'Гео совпадает', 'Пробное списание прошло']),
      ],
    },
  },
];

async function wipe() {
  const tag = await prisma.tag.findUnique({ where: { slug: DEMO_TAG } });
  if (!tag) {
    console.log('[seed:demo] демо-контента нет');
    return;
  }
  const links = await prisma.guideTag.findMany({ where: { tagId: tag.id }, select: { guideId: true } });
  const ids = links.map((l) => l.guideId);
  if (ids.length) {
    await prisma.guide.deleteMany({ where: { id: { in: ids } } });
    await revalidateWeb(['/']);
    console.log(`[seed:demo] удалено гайдов: ${ids.length}`);
  }
  await prisma.tag.delete({ where: { id: tag.id } });
}

async function create() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  if (!admin) {
    console.error('[seed:demo] нет ни одного администратора. Сначала: npm run seed');
    process.exit(1);
  }

  const tag = await prisma.tag.upsert({
    where: { slug: DEMO_TAG },
    create: { slug: DEMO_TAG, title: 'демо' },
    update: {},
  });

  let created = 0;
  for (const demo of DEMO) {
    const category = await prisma.category.findUnique({ where: { slug: demo.category } });
    if (!category) {
      console.warn(`[seed:demo] нет категории ${demo.category}, пропускаю «${demo.title}»`);
      continue;
    }

    const slug = slugify(demo.title);
    if (await prisma.guide.findUnique({ where: { slug } })) continue;

    const derived = await deriveContent(demo.doc);
    const guide = await prisma.guide.create({
      data: {
        slug,
        title: demo.title,
        summary: demo.summary,
        categoryId: category.id,
        level: demo.level,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        content: demo.doc as never,
        contentDraft: demo.doc as never,
        html: derived.html,
        plainText: derived.plainText,
        readingTimeSec: derived.readingTimeSec,
        requiredForRoles: demo.requiredForRoles ?? [],
        authorId: admin.id,
        version: 1,
      },
    });

    await prisma.guideTag.create({ data: { guideId: guide.id, tagId: tag.id } });
    await prisma.guideVersion.create({
      data: {
        guideId: guide.id,
        version: 1,
        title: guide.title,
        content: demo.doc as never,
        changedById: admin.id,
        changeNote: 'Демо-контент',
      },
    });
    await syncGuideMedia(guide.id, derived.mediaIds);
    created++;
  }

  // Демо-гайды пишутся прямо в базу, минуя API, поэтому ISR-кэш о них не знает
  await revalidateWeb(['/']);

  console.log(`[seed:demo] создано гайдов: ${created}`);
  console.log(`[seed:demo] удалить: npm run seed:demo wipe`);
  void EMPTY_DOC;
  void env;
}

const mode = process.argv[2];
try {
  if (mode === 'wipe') await wipe();
  else await create();
  await prisma.$disconnect();
  process.exit(0);
} catch (e) {
  console.error('[seed:demo] ошибка:', e);
  await prisma.$disconnect();
  process.exit(1);
}
