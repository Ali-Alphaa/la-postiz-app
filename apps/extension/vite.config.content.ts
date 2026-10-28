import { resolve } from 'path';
import { defineConfig } from 'vite';

// content scripts are classic scripts: one self-contained file
export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'src/x/content.ts'),
      name: 'postizXContent',
      formats: ['iife'],
      fileName: () => 'x-content.js',
    },
    target: 'esnext',
    minify: false,
    sourcemap: process.env.NODE_ENV === 'development',
  },
});
