import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
    },
  },
  server: {
    port: 5199,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./src/renderer/index.html', import.meta.url)),
        lyrics: fileURLToPath(new URL('./src/renderer/desktop-lyrics.html', import.meta.url)),
      },
    },
    outDir: fileURLToPath(new URL('./src/renderer/dist', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome128',
    chunkSizeWarningLimit: 1200,
  },
});
