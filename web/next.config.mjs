/** @type {import('next').NextConfig} */
const nextConfig = {
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
