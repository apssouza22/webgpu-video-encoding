import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'web',
  },
  server: {
    port: 5180,
  },
});
