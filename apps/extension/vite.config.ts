import { resolve } from 'path';
import { defineConfig } from 'vite';

// The service worker (ES module) and the options page. The x.com content
// script can't be a module, it is built on its own: vite.config.content.ts
export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        options: resolve(__dirname, 'src/options/options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: process.env.NODE_ENV === 'development',
  },
  publicDir: resolve(__dirname, 'public'),
});
