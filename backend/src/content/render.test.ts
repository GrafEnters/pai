import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTelegramInitData, verifyTelegramLoginWidget } from '../auth.js';
import { collectHeadings, collectMediaIds, slugify, type TipTapDoc } from './schema.js';
import { calcReadingTimeSec, emptyContext, toHtml, toMarkdown, toPlainText } from './render.js';

const doc: TipTapDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Что нужно до старта' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Проверьте ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'аккаунт' },
        { type: 'text', text: ' заранее.' },
      ],
    },
    {
      type: 'callout',
      attrs: { variant: 'danger', title: 'Не делайте так' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Уйдёт в бан.' }] }],
    },
    { type: 'image', attrs: { mediaId: 7, alt: 'Экран', caption: 'Подпись под картинкой' } },
    {
      type: 'checklist',
      attrs: { items: [{ id: 'a', text: 'Пиксель установлен' }] },
    },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Что нужно до старта' }] },
  ],
};

describe('toPlainText', () => {
  it('разделяет блоки переводом строки, чтобы слова не склеивались', () => {
    const text = toPlainText(doc);
    expect(text).toContain('Что нужно до старта\nПроверьте аккаунт заранее.');
    // Между блоками не должно быть склейки вида «заранее.Не делайте»
    expect(text).not.toMatch(/[а-яё.][А-ЯЁ][а-яё]/);
  });

  it('вытаскивает текст из callout, подписей и чеклиста — он тоже ищется', () => {
    const text = toPlainText(doc);
    expect(text).toContain('Не делайте так');
    expect(text).toContain('Подпись под картинкой');
    expect(text).toContain('Пиксель установлен');
  });
});

describe('toHtml', () => {
  it('ставит якоря заголовкам и разводит одинаковые', () => {
    const html = toHtml(doc, emptyContext());
    expect(html).toContain('<h2 id="chto-nuzhno-do-starta">');
    expect(html).toContain('<h2 id="chto-nuzhno-do-starta-2">');
  });

  it('экранирует опасный текст', () => {
    const evil: TipTapDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }],
    };
    const html = toHtml(evil, emptyContext());
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('внешним ссылкам добавляет rel="noopener noreferrer"', () => {
    const linked: TipTapDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }], text: 'туда' },
          ],
        },
      ],
    };
    expect(toHtml(linked, emptyContext())).toContain('rel="noopener noreferrer"');
  });

  it('пропускает медиа, которого нет в базе, а не падает', () => {
    expect(() => toHtml(doc, emptyContext())).not.toThrow();
  });
});

describe('toMarkdown', () => {
  it('делает читаемый глазами текст — это требование к бэкапу', () => {
    const md = toMarkdown(doc, emptyContext());
    expect(md).toContain('## Что нужно до старта');
    expect(md).toContain('**аккаунт**');
    expect(md).toContain('🛑 **Не делайте так**');
    expect(md).toContain('- [ ] Пиксель установлен');
  });
});

describe('calcReadingTimeSec', () => {
  it('не бывает меньше 30 секунд', () => {
    const tiny: TipTapDoc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ок' }] }] };
    expect(calcReadingTimeSec(tiny, emptyContext())).toBe(30);
  });

  it('учитывает длительность видео целиком', () => {
    const withVideo: TipTapDoc = { type: 'doc', content: [{ type: 'video', attrs: { mediaId: 1 } }] };
    const ctx = emptyContext();
    ctx.media.set(1, {
      id: 1,
      type: 'VIDEO',
      url: '',
      posterUrl: null,
      srcset: { avif: null, webp: null },
      alt: null,
      originalName: 'v.mp4',
      width: null,
      height: null,
      durationSec: 600,
      sizeBytes: '0',
    });
    expect(calcReadingTimeSec(withVideo, ctx)).toBeGreaterThanOrEqual(600);
  });
});

describe('сбор ссылок', () => {
  it('находит все mediaId', () => {
    const gallery: TipTapDoc = {
      type: 'doc',
      content: [{ type: 'image', attrs: { mediaId: 1 } }, { type: 'gallery', attrs: { mediaIds: [2, 3] } }],
    };
    expect(collectMediaIds(gallery).sort()).toEqual([1, 2, 3]);
  });

  it('собирает оглавление только из h2–h4', () => {
    const headings = collectHeadings(doc);
    expect(headings.map((h) => h.anchor)).toEqual(['chto-nuzhno-do-starta', 'chto-nuzhno-do-starta-2']);
  });
});

describe('slugify', () => {
  it('транслитерирует кириллицу', () => {
    expect(slugify('Запуск первой кампании')).toBe('zapusk-pervoy-kampanii');
    expect(slugify('Прокси: настройка 2024')).toBe('proksi-nastroyka-2024');
  });

  it('никогда не возвращает пустую строку', () => {
    expect(slugify('!!!')).toBe('guide');
  });
});

describe('Telegram', () => {
  const BOT_TOKEN = '123456:TEST-TOKEN';

  it('принимает корректный initData Mini App', () => {
    const params = new URLSearchParams({
      auth_date: '1700000000',
      query_id: 'AAA',
      user: JSON.stringify({ id: 42, username: 'tester' }),
    });
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex'));

    const result = verifyTelegramInitData(params.toString(), BOT_TOKEN);
    expect(result?.user?.id).toBe(42);
    expect(result?.user?.username).toBe('tester');
  });

  it('отвергает подделанный hash', () => {
    const params = new URLSearchParams({ auth_date: '1700000000', user: '{"id":42}', hash: 'deadbeef' });
    expect(verifyTelegramInitData(params.toString(), BOT_TOKEN)).toBeNull();
  });

  it('у Login Widget другой алгоритм секрета — проверяем именно его', () => {
    const now = Math.floor(Date.now() / 1000);
    const payload: Record<string, string> = { id: '42', username: 'tester', auth_date: String(now) };
    const dataCheckString = Object.keys(payload)
      .sort()
      .map((k) => `${k}=${payload[k]}`)
      .join('\n');
    const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    payload.hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    expect(verifyTelegramLoginWidget(payload, BOT_TOKEN)?.id).toBe(42);
    // Тот же payload с алгоритмом Mini App не пройти не должен
    expect(verifyTelegramInitData(new URLSearchParams(payload).toString(), BOT_TOKEN)).toBeNull();
  });

  it('отвергает просроченную подпись Login Widget', () => {
    const old = Math.floor(Date.now() / 1000) - 7200;
    const payload: Record<string, string> = { id: '42', auth_date: String(old) };
    const dataCheckString = Object.keys(payload)
      .sort()
      .map((k) => `${k}=${payload[k]}`)
      .join('\n');
    const secret = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    payload.hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    expect(verifyTelegramLoginWidget(payload, BOT_TOKEN)).toBeNull();
  });
});
