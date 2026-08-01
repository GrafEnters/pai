/**
 * Демо-гайды с видео. Берёт все загруженные видеофайлы и раскладывает их
 * по гайдам в разных сочетаниях — чтобы посмотреть, как видео выглядит
 * в разных местах документа.
 *
 *   npm run seed:video        — создать
 *   npm run seed:video wipe   — удалить
 *
 * Гайды помечены тегом `video-demo` и удаляются одной командой.
 */
import { prisma } from './db.js';
import { slugify, type DocNode, type TipTapDoc } from './content/schema.js';
import { deriveContent, syncGuideMedia } from './services/guides.js';
import { revalidateWeb } from './services/cdn.js';

const TAG = 'video-demo';

const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const h = (level: number, text: string): DocNode => ({
  type: 'heading',
  attrs: { level },
  content: [{ type: 'text', text }],
});
const video = (mediaId: number): DocNode => ({ type: 'video', attrs: { mediaId } });
const callout = (variant: string, title: string, text: string): DocNode => ({
  type: 'callout',
  attrs: { variant, title },
  content: [p(text)],
});
const checklist = (items: string[]): DocNode => ({
  type: 'checklist',
  attrs: { persistKey: 'main', items: items.map((text, i) => ({ id: `i${i}`, text })) },
});
const details = (summary: string, content: DocNode[]): DocNode => ({
  type: 'details',
  attrs: { summary },
  content,
});
const bullets = (items: string[]): DocNode => ({
  type: 'bulletList',
  content: items.map((text) => ({ type: 'listItem', content: [p(text)] })),
});

/** Шаблон гайда: получает очередные видео и возвращает документ. */
interface Template {
  title: string;
  summary: string;
  category: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  requiredForRoles?: ('BUYER' | 'FARMER' | 'TECH' | 'MEDIABUYER' | 'MANAGER' | 'OTHER')[];
  /** Сколько видео нужно шаблону */
  videos: number;
  build: (ids: number[]) => DocNode[];
}

const TEMPLATES: Template[] = [
  {
    // Видео сразу под заголовком — самый частый случай для видеогайда
    title: 'Видеоразбор: запуск кампании от и до',
    summary: 'Полная запись экрана: от создания кабинета до первого открута.',
    category: 'facebook',
    level: 'BEGINNER',
    requiredForRoles: ['BUYER', 'MEDIABUYER'],
    videos: 1,
    build: ([v]) => [
      p('Ниже — полная запись процесса. Если торопитесь, разделы слева ведут к нужному месту.'),
      video(v!),

      h(2, 'Подготовка'),
      p('До запуска нужно закрыть три вещи. Каждая разобрана отдельно.'),
      h(3, 'Рекламный кабинет'),
      p('Берём кабинет с историей, а не свежесозданный: у свежего лимит на старте вдвое ниже.'),
      h(3, 'Платёжка'),
      p('Гео карты должно совпадать с гео кабинета, иначе привязка не пройдёт.'),
      h(3, 'Пиксель'),
      p('Ставим до первого запуска и обязательно проверяем, что события доезжают.'),
      h(4, 'Проверка событий'),
      p('Открываем отладчик и смотрим, что срабатывает просмотр и целевое действие.'),
      h(4, 'Типичные ошибки установки'),
      bullets(['Пиксель стоит только на главной', 'Дубль пикселя на одной странице', 'Событие вешают на клик, а не на факт покупки']),

      h(2, 'Запуск'),
      h(3, 'Настройка кампании'),
      p('Цель — «Конверсии». «Трафик» даёт дешёвые клики и нулевой результат.'),
      h(4, 'Аудитория'),
      p('На старте не сужаем: алгоритму нужен объём, чтобы найти платящих.'),
      h(4, 'Бюджет'),
      p('Начинаем с минимального и поднимаем не больше чем на 20% в сутки.'),
      h(3, 'Первые два часа'),
      p('Смотрим на скорость открута и цену целевого действия. Не трогаем настройки.'),
      callout('warn', 'Внимание', 'На записи бюджет выставлен тестовый. Для боевого запуска смотрите гайд по антибану.'),

      h(2, 'Частые ошибки'),
      h(3, 'Ранняя оптимизация'),
      p('Правки в первые сутки сбрасывают обучение — кампания начинает заново.'),
      h(3, 'Долив бюджета в просадку'),
      p('Долить деньги в падающую связку — самый дорогой способ ничего не исправить.'),

      h(2, 'Чеклист'),
      checklist(['Посмотрел запись целиком', 'Пиксель проверен в отладчике', 'Повторил на тестовом кабинете', 'Задал вопросы в чате']),
    ],
  },
  {
    // Несколько видео подряд — разные части одного процесса
    title: 'Фарм аккаунтов: три записи по этапам',
    summary: 'Прогрев, наполнение и передача в работу — три отдельные записи.',
    category: 'facebook',
    level: 'INTERMEDIATE',
    requiredForRoles: ['FARMER'],
    videos: 3,
    build: ([a, b, c]) => [
      p('Процесс разбит на три части. Каждую можно смотреть отдельно.'),

      h(2, 'Часть 1. Прогрев'),
      p('Первые трое суток: что делать с аккаунтом, чтобы он не выглядел свежим.'),
      video(a!),
      h(3, 'Расписание первых суток'),
      p('Заходим дважды, сессия по 15–20 минут, без резких действий.'),
      h(3, 'Чего не делать'),
      bullets(['Не вступать в группы пачками', 'Не менять гео между сессиями', 'Не заходить с домашнего IP']),

      h(2, 'Часть 2. Наполнение'),
      p('Друзья, группы, активность. Темп важнее объёма.'),
      video(b!),
      h(3, 'Друзья'),
      p('До двадцати заявок в сутки, принимаем не все подряд.'),
      h(3, 'Контент'),
      p('Пара постов и реакции — этого достаточно, чтобы профиль выглядел живым.'),

      h(2, 'Часть 3. Передача в работу'),
      p('Что проверить перед тем, как отдавать аккаунт байеру.'),
      video(c!),
      h(3, 'Приёмка'),
      checklist(['Прогрев ≥ 3 суток', 'Активность выглядит естественно', 'Платёжка привязана и проверена', 'Профиль и прокси зафиксированы за аккаунтом']),
    ],
  },
  {
    // Видео внутри пошаговой инструкции
    title: 'Настройка антидетекта: пошагово с записью',
    summary: 'Каждый шаг показан на видео. Повторяйте параллельно.',
    category: 'proxy',
    level: 'BEGINNER',
    requiredForRoles: ['TECH', 'FARMER'],
    videos: 2,
    build: ([a, b]) => [
      p('Ставьте на паузу после каждого шага и повторяйте у себя.'),
      {
        type: 'steps',
        content: [
          {
            type: 'step',
            attrs: { title: 'Создать профиль' },
            content: [p('Отпечаток берём под нужное гео, часовой пояс подтягиваем автоматически.'), video(a!)],
          },
          {
            type: 'step',
            attrs: { title: 'Подключить прокси и проверить утечки' },
            content: [p('После подключения обязательно проверяем WebRTC и DNS.'), video(b!)],
          },
        ],
      },
      callout('danger', 'Частая ошибка', 'Профиль с одним отпечатком и разными прокси в разные дни — прямой путь к связке аккаунтов.'),
    ],
  },
  {
    // Длинное видео + оглавление таймкодов текстом
    title: 'Разбор слитой связки: час записи',
    summary: 'Длинный разбор с комментариями. Таймкоды в описании.',
    category: 'facebook',
    level: 'ADVANCED',
    videos: 1,
    build: ([v]) => [
      callout('info', 'Как смотреть', 'Запись длинная. Плеер запоминает позицию — можно вернуться позже с того же места.'),
      video(v!),
      h(2, 'О чём разбор'),
      p('Разбираем связку, которая перестала работать: что именно изменилось на стороне площадки и что можно было заметить раньше.'),
      details('Что стоит пересмотреть отдельно', [
        bullets([
          'Момент, где видно первый признак просадки',
          'Реакция на изменение стоимости целевого действия',
          'Почему решение «долить бюджет» сделало хуже',
        ]),
      ]),
    ],
  },
  {
    // Короткое видео как иллюстрация к тексту
    title: 'TikTok: что заворачивает модерация',
    summary: 'Короткая запись с примерами отклонённых креативов.',
    category: 'tiktok',
    level: 'INTERMEDIATE',
    videos: 2,
    build: ([a, b]) => [
      h(2, 'Типичные отказы'),
      p('Три четверти отказов — это обещание результата, медицинская тематика и чужие товарные знаки в кадре.'),
      video(a!),
      h(2, 'Как переделать'),
      p('Ниже показано, как тот же креатив проходит модерацию после правок.'),
      video(b!),
      callout('success', 'Хорошая практика', 'Держите две версии креатива: агрессивную и мягкую. Мягкая проходит всегда.'),
    ],
  },
  {
    // Видео в сворачиваемом блоке — приложение к текстовому гайду
    title: 'Платёжки: привязка карты и что делать при отказе',
    summary: 'Текстовая инструкция, запись экрана — в приложении.',
    category: 'payments',
    level: 'BEGINNER',
    videos: 2,
    build: ([a, b]) => [
      h(2, 'Коротко'),
      bullets([
        'Гео карты должно совпадать с гео аккаунта',
        'Первым делом пробное списание на один доллар',
        'При отказе — не повторять подряд, ждать сутки',
      ]),
      checklist(['Лимит проверен', 'Гео совпадает', 'Пробное списание прошло']),
      details('Приложение: запись привязки', [p('Полный процесс от начала до конца.'), video(a!)]),
      details('Приложение: что видно при отказе', [p('Как выглядит отказ и что смотреть в логах.'), video(b!)]),
    ],
  },
  {
    // Онбординг с видео-приветствием
    title: 'Онбординг: видеоприветствие и обзор инструментов',
    summary: 'С чего начать в первый день. Обязательно к просмотру.',
    category: 'onboarding',
    level: 'BEGINNER',
    requiredForRoles: ['BUYER', 'FARMER', 'TECH', 'MEDIABUYER', 'MANAGER', 'OTHER'],
    videos: 2,
    build: ([a, b]) => [
      p('Добро пожаловать. Посмотрите две записи — на них весь рабочий контур.'),
      h(2, 'Обзор инструментов'),
      video(a!),
      h(2, 'Как устроена работа внутри команды'),
      video(b!),
      checklist([
        'Посмотрел обе записи',
        'Получил доступы',
        'Прочитал обязательные гайды для своей роли',
        'Представился в рабочем чате',
      ]),
      callout('info', 'Дальше', 'После этого гайда откройте «Настройка антидетекта» — там всё показано пошагово.'),
    ],
  },
  {
    // Гайд, где видео идёт последним — как приложение
    title: 'Прокси: диагностика на живом примере',
    summary: 'Теория коротко, дальше — запись реальной диагностики.',
    category: 'proxy',
    level: 'INTERMEDIATE',
    requiredForRoles: ['TECH'],
    videos: 2,
    build: ([a, b]) => [
      h(2, 'Порядок диагностики'),
      {
        type: 'steps',
        content: [
          { type: 'step', attrs: { title: 'Пинг' }, content: [p('Больше 250 мс до нужного гео — меняем.')] },
          { type: 'step', attrs: { title: 'Утечки' }, content: [p('WebRTC и DNS — обе проверки обязательны.')] },
          { type: 'step', attrs: { title: 'Блэклисты' }, content: [p('Проверяем IP по спискам перед выдачей в работу.')] },
        ],
      },
      h(2, 'Как это выглядит вживую'),
      h(3, 'Рабочий прокси'),
      p('Пинг в норме, утечек нет, IP чистый.'),
      video(a!),
      h(3, 'Заведомо плохой'),
      p('Та же проверка на прокси, который брать нельзя — разница видна сразу.'),
      video(b!),
      h(4, 'На что смотреть в первую очередь'),
      bullets(['Расхождение гео IP и часового пояса', 'WebRTC отдаёт реальный адрес', 'IP светится в публичных списках']),
    ],
  },
  {
    // Гайд с максимумом видео — проверка, как страница держит много плееров
    title: 'Архив записей: всё, что не влезло в другие гайды',
    summary: 'Свалка полезных записей. Разбираем и растаскиваем по темам.',
    category: 'onboarding',
    level: 'ADVANCED',
    videos: 3,
    build: (ids) => [
      callout('warn', 'Временный гайд', 'Это черновая свалка записей. По мере разбора они переезжают в тематические гайды.'),
      ...ids.flatMap((id, i) => [h(3, `Запись ${i + 1}`), video(id)]),
    ],
  },
];

async function wipe() {
  const tag = await prisma.tag.findUnique({ where: { slug: TAG } });
  if (!tag) {
    console.log('[seed:video] видео-гайдов нет');
    return;
  }
  const links = await prisma.guideTag.findMany({ where: { tagId: tag.id }, select: { guideId: true } });
  const ids = links.map((l) => l.guideId);
  if (ids.length) {
    await prisma.guide.deleteMany({ where: { id: { in: ids } } });
    await revalidateWeb(['/']);
    console.log(`[seed:video] удалено гайдов: ${ids.length}`);
  }
  await prisma.tag.delete({ where: { id: tag.id } });
}

async function create() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { id: 'asc' } });
  if (!admin) {
    console.error('[seed:video] нет администратора. Сначала: npm run seed');
    process.exit(1);
  }

  const videos = await prisma.media.findMany({
    where: { type: 'VIDEO', status: 'READY' },
    orderBy: { id: 'asc' },
    select: { id: true, originalName: true, durationSec: true, posterKey: true },
  });

  if (!videos.length) {
    console.error('[seed:video] в библиотеке нет обработанных видео — загрузите их в админке');
    process.exit(1);
  }

  const withPoster = videos.filter((v) => v.posterKey).length;
  console.log(`[seed:video] видео в библиотеке: ${videos.length}, из них с постером: ${withPoster}`);

  const tag = await prisma.tag.upsert({
    where: { slug: TAG },
    create: { slug: TAG, title: 'видео' },
    update: {},
  });

  // Раздаём видео по кругу: шаблонов меньше, чем файлов, поэтому длинные
  // гайды получают несколько разных записей
  let cursor = 0;
  const take = (n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      out.push(videos[cursor % videos.length]!.id);
      cursor++;
    }
    return out;
  };

  let created = 0;
  for (const template of TEMPLATES) {
    const slug = slugify(template.title);
    if (await prisma.guide.findUnique({ where: { slug } })) continue;

    const category = await prisma.category.findUnique({ where: { slug: template.category } });
    if (!category) {
      console.warn(`[seed:video] нет категории ${template.category}, пропускаю «${template.title}»`);
      continue;
    }

    const doc: TipTapDoc = { type: 'doc', content: template.build(take(template.videos)) };
    const derived = await deriveContent(doc);

    const guide = await prisma.guide.create({
      data: {
        slug,
        title: template.title,
        summary: template.summary,
        categoryId: category.id,
        level: template.level,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        content: doc as never,
        contentDraft: doc as never,
        html: derived.html,
        plainText: derived.plainText,
        readingTimeSec: derived.readingTimeSec,
        requiredForRoles: template.requiredForRoles ?? [],
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
        content: doc as never,
        changedById: admin.id,
        changeNote: 'Демо-гайд с видео',
      },
    });
    await syncGuideMedia(guide.id, derived.mediaIds);

    const mins = Math.round(derived.readingTimeSec / 60);
    console.log(`[seed:video] «${template.title}» — ${template.videos} видео, ~${mins} мин`);
    created++;
  }

  await revalidateWeb(['/']);
  console.log(`\n[seed:video] создано гайдов: ${created}`);
  console.log('[seed:video] удалить: npm run seed:video wipe');
}

const mode = process.argv[2];
try {
  if (mode === 'wipe') await wipe();
  else await create();
  await prisma.$disconnect();
  process.exit(0);
} catch (e) {
  console.error('[seed:video] ошибка:', e);
  await prisma.$disconnect();
  process.exit(1);
}
