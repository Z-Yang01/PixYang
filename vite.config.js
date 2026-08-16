import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(async () => {
  const tailwindcss = (await import('@tailwindcss/vite')).default;
  return {
    plugins: [react(), tailwindcss()],
    base: './',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
    server: {
      port: 5173,
      strictPort: true,
    },
  };
});
