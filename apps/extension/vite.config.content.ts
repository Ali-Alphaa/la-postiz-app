import { resolve } from 'path';
import { defineConfig } from 'vite';

// content scripts are classic scripts: one self-contained file each, built
// one at a time (CONTENT_ENTRY=x|instagram|tiktok)
const entries: Record<string, string> = {
  x: 'src/x/content.ts',
  instagram: 'src/instagram/content.ts',
  tiktok: 'src/tiktok/content.ts',
};
const entry = process.env.CONTENT_ENTRY || 'x';

export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, entries[entry]),
      name: `postiz_${entry}_content`,
      formats: ['iife'],
      fileName: () => `${entry}-content.js`,
    },
    target: 'esnext',
    minify: false,
    sourcemap: process.env.NODE_ENV === 'development',
  },
});
