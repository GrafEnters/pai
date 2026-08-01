import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Берём порт и API из общего корневого .env
  const env = loadEnv(mode, process.cwd() + '/..', '');
  const port = Number(env.ADMIN_PORT ?? 5173);
  // Пустая строка — осознанное значение «тот же origin»: так собирается образ
  // для Amvera, где админка живёт на /admin/ того же домена, что и API.
  const apiUrl = env.VITE_API_URL ?? 'http://localhost:3001';
  // На Amvera админка отдаётся с подпути; локально — с корня
  const base = env.ADMIN_BASE ?? (apiUrl === '' ? '/admin/' : '/');
  return {
    base,
    plugins: [react()],
    envDir: '../',
    server: {
      port,
      host: true,
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl),
    },
  };
});
