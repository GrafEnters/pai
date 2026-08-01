import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import { env } from '../env.js';
import { describeError } from '../errors.js';

/**
 * Проверка исходящей связи прямо из контейнера.
 *
 * Зачем это в приложении, а не в консоли: у Amvera консоли нет — ни curl, ни
 * dig, ни ping изнутри выполнить негде. А бэкап падает на `connect ETIMEDOUT`,
 * ошибке сетевого уровня, про которую логи приложения не говорят ничего сверх
 * самого факта. Проверка ходит теми же путями, что и рабочий код, и отвечает
 * на единственный вопрос: сломано у нас или маршрут наружу.
 *
 * Ключевая деталь — два HTTP-стека на один и тот же адрес. `fetch` в Node это
 * undici; `google-auth-library`, которой обновляется OAuth-токен, ходит через
 * node:https. В логе прогона #5 токен обновился успешно, а запрос к API упал
 * по таймауту — то есть один стек прошёл там, где другой не смог, и различать
 * их обязательно: расхождение указывает на клиент, общий отказ — на маршрут.
 */

const CONNECT_TIMEOUT_MS = 3_000;
const HTTP_TIMEOUT_MS = 10_000;
/**
 * Google отдаёт по десятку адресов на хост, и каждый недоступный стоит полного
 * таймаута. Проверять все — это минуты, а запрос оборвёт nginx раньше. Четырёх
 * на семейство хватает: адреса одного хоста живут в одной подсети и отвечают
 * одинаково. Сколько адресов осталось непроверенными, отчёт говорит прямо.
 */
const MAX_ADDRESSES_PER_FAMILY = 4;

interface ProbeResult {
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
}

interface TcpResult {
  address: string;
  family: 4 | 6;
  ok: boolean;
  ms: number;
  error?: string;
}

interface HostReport {
  host: string;
  role: string;
  dns: { lookup: string[]; a: string[]; aaaa: string[]; error?: string };
  tcp: TcpResult[];
  /** Сколько адресов не проверяли из-за лимита — чтобы отчёт не выглядел полным, не будучи им */
  skipped: number;
  /** undici — им ходит весь наш код */
  viaFetch: ProbeResult;
  /** node:https — им ходит google-auth-library */
  viaHttps: ProbeResult;
}

export interface NetCheckReport {
  runtime: { node: string; undici: string; openssl: string; platform: string };
  /** Внешний адрес, с которого нас видит интернет: при переезде контейнера он меняется */
  egressIp: string | null;
  hosts: HostReport[];
  summary: string[];
}

/** TCP-соединение до конкретного адреса. Ответ сервера не важен — важен сам факт. */
function tcpConnect(address: string, port: number, family: 4 | 6): Promise<TcpResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host: address, port, family });
    const finish = (result: Omit<TcpResult, 'address' | 'family'>) => {
      socket.destroy();
      resolve({ address, family, ...result });
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => finish({ ok: true, ms: Date.now() - started }));
    socket.once('timeout', () =>
      finish({ ok: false, ms: Date.now() - started, error: `таймаут ${CONNECT_TIMEOUT_MS / 1000} с` }),
    );
    socket.once('error', (e) => finish({ ok: false, ms: Date.now() - started, error: describeError(e) }));
  });
}

/** Запрос через undici — тот же путь, которым ходит провайдер Drive. */
async function probeFetch(url: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    // Тело не читаем: код ответа не важен, важно что соединение состоялось
    return { ok: true, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, ms: Date.now() - started, error: describeError(e) };
  }
}

/** Тот же адрес через node:https — путь google-auth-library. */
function probeHttps(url: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.request(url, { method: 'GET', timeout: HTTP_TIMEOUT_MS }, (res) => {
      res.resume(); // тело не нужно, но поток надо освободить
      resolve({ ok: true, status: res.statusCode, ms: Date.now() - started });
    });
    req.once('timeout', () => {
      req.destroy();
      resolve({ ok: false, ms: Date.now() - started, error: `таймаут ${HTTP_TIMEOUT_MS / 1000} с` });
    });
    req.once('error', (e) => resolve({ ok: false, ms: Date.now() - started, error: describeError(e) }));
    req.end();
  });
}

async function resolveHost(host: string): Promise<HostReport['dns']> {
  const out: HostReport['dns'] = { lookup: [], a: [], aaaa: [] };
  try {
    // lookup — это getaddrinfo, ровно то, чем адрес выбирает сам Node при
    // соединении. resolve4/resolve6 идут в DNS напрямую и могут разойтись
    // с ним: расхождение само по себе объясняет «резолвится, но не грузится»
    const all = await dns.lookup(host, { all: true });
    out.lookup = all.map((a) => `${a.address} (v${a.family})`);
  } catch (e) {
    out.error = describeError(e);
  }
  out.a = await dns.resolve4(host).catch(() => []);
  out.aaaa = await dns.resolve6(host).catch(() => []);
  return out;
}

async function checkHost(host: string, role: string): Promise<HostReport> {
  const resolved = await resolveHost(host);
  const url = `https://${host}/`;

  const addresses: { address: string; family: 4 | 6 }[] = [
    ...resolved.a.slice(0, MAX_ADDRESSES_PER_FAMILY).map((address) => ({ address, family: 4 as const })),
    ...resolved.aaaa.slice(0, MAX_ADDRESSES_PER_FAMILY).map((address) => ({ address, family: 6 as const })),
  ];
  const skipped = resolved.a.length + resolved.aaaa.length - addresses.length;

  // Параллельно: адреса независимы, а недоступные стоят полного таймаута каждый
  const tcp = await Promise.all(addresses.map(({ address, family }) => tcpConnect(address, 443, family)));

  const [viaFetch, viaHttps] = await Promise.all([probeFetch(url), probeHttps(url)]);
  return { host, role, dns: resolved, tcp, skipped, viaFetch, viaHttps };
}

/** Внешний адрес контейнера. Cloudflare отдаёт его текстом и доказанно доступен. */
async function egressIp(): Promise<string | null> {
  try {
    const res = await fetch('https://cloudflare.com/cdn-cgi/trace', {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    const text = await res.text();
    return text.match(/^ip=(.+)$/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function netcheck(): Promise<NetCheckReport> {
  const targets: { host: string; role: string }[] = [
    { host: 'www.googleapis.com', role: 'Drive API — на нём падает бэкап' },
    { host: 'oauth2.googleapis.com', role: 'обновление OAuth-токена — оно проходило' },
    { host: 'storage.googleapis.com', role: 'соседний хост Google — контроль подсети' },
  ];

  // Хранилище медиа — заведомо рабочее направление. Если и оно молчит,
  // разговор не про Google, а про исходящую связь целиком
  const r2Host = env.storage.r2.endpoint ? safeHost(env.storage.r2.endpoint) : null;
  if (r2Host) targets.push({ host: r2Host, role: 'R2 — контроль, это направление работает' });

  const [ip, hosts] = await Promise.all([
    egressIp(),
    (async () => {
      const out: HostReport[] = [];
      for (const target of targets) out.push(await checkHost(target.host, target.role));
      return out;
    })(),
  ]);

  return {
    runtime: {
      node: process.version,
      undici: process.versions.undici ?? '—',
      openssl: process.versions.openssl,
      platform: `${process.platform}/${process.arch}`,
    },
    egressIp: ip,
    hosts,
    summary: hosts.map(summarize),
  };
}

function summarize(report: HostReport): string {
  const tcp = report.tcp.length
    ? report.tcp.map((t) => `${t.address} ${t.ok ? `${t.ms} мс` : (t.error ?? 'отказ')}`).join(', ')
    : 'адресов нет';
  const fetchLine = report.viaFetch.ok ? `undici ${report.viaFetch.status}` : `undici ✗ (${report.viaFetch.error})`;
  const httpsLine = report.viaHttps.ok ? `node:https ${report.viaHttps.status}` : `node:https ✗ (${report.viaHttps.error})`;
  const rest = report.skipped ? ` (+${report.skipped} адресов не проверяли)` : '';
  return `${report.host}: ${tcp}${rest}; ${fetchLine}; ${httpsLine}`;
}

/** Из endpoint вида https://<account>.r2.cloudflarestorage.com берём только хост. */
function safeHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}
