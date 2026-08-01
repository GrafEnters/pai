/**
 * Проверка хранилища медиа тем же путём, которым ходит браузер.
 *
 *   npm run storage:check
 *   npm run storage:check -- --size=50   (МиБ, по умолчанию 12)
 *
 * Зачем отдельный скрипт, а не «загружу картинку в админке и посмотрю»:
 * при отказе админка показывает один статус, и по нему не отличить неверную
 * подпись от незакрытого CORS или неправильного публичного домена. Здесь
 * каждый шаг отвечает за себя и печатает причину.
 *
 * Размер по умолчанию — 12 МиБ, и это не случайное число: балансировщик
 * Amvera режет тело на 10 МиБ. Файл такого размера доказывает, что загрузка
 * идёт мимо площадки, прямо в бакет.
 */
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { env } from '../env.js';
import { describeError } from '../errors.js';
import { storage } from '../services/storage/index.js';

const sizeArg = process.argv.find((a) => a.startsWith('--size='));
const sizeMib = Number(sizeArg?.split('=')[1] ?? 12);
if (!Number.isFinite(sizeMib) || sizeMib <= 0) {
  console.error(`Некорректный размер: ${sizeArg}`);
  process.exit(1);
}

const KEY = `_healthcheck/${crypto.randomBytes(8).toString('hex')}.bin`;
const MIME = 'application/octet-stream';
const payload = crypto.randomBytes(Math.round(sizeMib * 1024 * 1024));
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

let failed = 0;

async function step(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn();
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ОШИБКА ${name}: ${describeError(e)}`);
  }
}

const isLocal = storage.name === 'local';

console.log(`Хранилище: ${storage.name}, пробный объект ${sizeMib} МиБ, ключ ${KEY}`);
if (isLocal) {
  // Иначе зелёный прогон читается как «всё готово», хотя проверено ровно то,
  // что на проде и не работает: локальное хранилище принимает файл через сам
  // backend, а балансировщик Amvera такой запрос обрывает на 10 МиБ
  console.log(
    'ВНИМАНИЕ: проверяется локальная папка, а не внешний бакет. Этот прогон\n' +
      'НЕ доказывает, что загрузка пройдёт на Amvera: туда файл идёт через\n' +
      'площадку, и всё, что больше 10 МиБ, она отбивает. Для боевой проверки\n' +
      'задайте STORAGE_PROVIDER=r2 (см. SETUP.md, приложение Б).',
  );
}
console.log('');

let uploadUrl = '';
let uploadHeaders: Record<string, string> = {};

await step('presignPut — выдача ссылки', async () => {
  const presign = await storage.presignPut(KEY, MIME, payload.length);
  uploadUrl = presign.url;
  uploadHeaders = presign.headers;
  return new URL(uploadUrl, 'http://localhost').host || 'относительная ссылка на сам backend';
});

// Браузер перед загрузкой спрашивает у бакета разрешение. Незакрытый CORS —
// самая частая причина «в админке ничего не грузится», и в логах его не видно:
// запрос браузер отменяет сам, до сервера он не доходит
if (uploadUrl.startsWith('http')) {
  await step('CORS — preflight с адреса админки', async () => {
    const origin = env.publicAdminUrl || env.publicWebUrl;
    const res = await fetch(uploadUrl, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': Object.keys(uploadHeaders).join(','),
      },
    });
    const allow = res.headers.get('access-control-allow-origin');
    if (!allow) {
      throw new Error(
        `бакет не вернул access-control-allow-origin для ${origin} (HTTP ${res.status}). ` +
          'Браузер такую загрузку заблокирует — настройте CORS, см. SETUP.md, приложение Б',
      );
    }
    return `разрешён ${allow}`;
  });
}

await step('PUT по presigned-ссылке', async () => {
  const res = await fetch(uploadUrl, { method: 'PUT', headers: uploadHeaders, body: new Uint8Array(payload) });
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`HTTP ${res.status} ${body}`);
  }
  return `${sizeMib} МиБ загружено`;
});

await step('exists', async () => {
  if (!(await storage.exists(KEY))) throw new Error('объект не найден сразу после загрузки');
});

await step('чтение потоком и сверка sha256', async () => {
  const chunks: Buffer[] = [];
  await pipeline(await storage.get(KEY), async function* (source) {
    for await (const chunk of source) chunks.push(Buffer.from(chunk as Buffer));
  });
  const got = Buffer.concat(chunks);
  if (sha(got) !== sha(payload)) throw new Error(`содержимое отличается (${got.length} вместо ${payload.length} байт)`);
  return 'совпало';
});

await step('публичная ссылка', async () => {
  const url = storage.publicUrl(KEY);
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const len = (await res.arrayBuffer()).byteLength;
  if (len !== payload.length) throw new Error(`по ссылке пришло ${len} байт вместо ${payload.length}`);
  return url;
});

await step('удаление пробного объекта', async () => {
  await storage.delete(KEY);
  if (await storage.exists(KEY)) throw new Error('объект остался в хранилище');
});

if (failed) {
  console.log(`\nНе прошло шагов: ${failed}. Хранилище к работе не готово.`);
} else if (isLocal) {
  console.log(
    '\nЛокальная папка работает: подпись, чтение, раздача и удаление в порядке.\n' +
      'Но это ещё не готовность к бою — на Amvera такой файл не доедет.',
  );
} else {
  console.log('\nВсе шаги прошли: загрузка мимо площадки, чтение, раздача и удаление работают.');
}
process.exit(failed ? 1 : 0);
