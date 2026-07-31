import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Берём порт и API из общего корневого .env
  const env = loadEnv(mode, process.cwd() + '/..', '');
  const port = Number(env.ADMIN_PORT ?? 5173);
  const apiUrl = env.VITE_API_URL ?? 'http://localhost:3001';
  return {
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
