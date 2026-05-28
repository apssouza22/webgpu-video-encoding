import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/webgpu-video-encoding/' : '/',
  build: {
    outDir: 'docs',
  },
  server: {
    port: 5180,
  },
}));
