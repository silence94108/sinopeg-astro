// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  outDir: './sinopeg-output',  // 打包输出目录，可以改成任意路径，如 './build' 或 '../sinopeg-output'
  vite: {
    cacheDir: '.astro/vite-cache'
  }
});
