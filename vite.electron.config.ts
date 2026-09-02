import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: {
        'electron/main': resolve(__dirname, 'src/electron/main.ts'),
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
        preserveModules: true,
        preserveModulesRoot: 'src',
      },
    },
    target: 'node22',
    minify: false,
  },
});
