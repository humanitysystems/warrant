import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: {
        'electron/main': resolve(__dirname, 'src/electron/main.ts'),
        'electron/preload': resolve(__dirname, 'src/electron/preload.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [
        'electron',
        'node:child_process',
        'node:path',
        'node:url',
        'node:module',
        'node:crypto',
        'node:fs/promises',
        'node:os',
      ],
      output: {
        preserveModules: false,
      },
    },
    target: 'node22',
    minify: false,
  },
});
