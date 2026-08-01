/** @type {import('next').NextConfig} */
const nextConfig = {
  // Дев-сервер и прод-сборка пишут в РАЗНЫЕ папки.
  // Иначе `next build`, запущенный при работающем `next dev`, затирает модульный
  // граф живого сервера, и страница падает с «__webpack_modules__[moduleId]
  // is not a function» — ошибка, по тексту которой причину не угадать.
  // Docker собирает с NODE_ENV=production и получает привычный .next.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',

  // Тонкий Docker-образ: next build кладёт всё нужное в .next/standalone
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // Картинки отдаёт наш storage/CDN со своими srcset — next/image не используем
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Сайт закрытый: не индексировать никогда (PLAN §5.5)
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
