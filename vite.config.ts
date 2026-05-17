import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import { builtinModules } from 'node:module';

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];
const mainExternals = [
  'electron',
  'pdf-lib',
  '@pdf-lib/fontkit',
  ...nodeExternals,
];

export default defineConfig({
  base: './',  // Electron file:// 协议下要用相对路径
  plugins: [
    react(),
    electron([
      {
        // 主进程
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            emptyOutDir: false,
            minify: false,
            lib: {
              entry: 'electron/main.ts',
              formats: ['cjs'],
              fileName: () => 'main.cjs',
            },
            rollupOptions: {
              external: mainExternals,
              output: { entryFileNames: 'main.cjs' },
            },
          },
        },
      },
      {
        // Preload
        entry: 'electron/preload.ts',
        onstart: ({ reload }) => reload(),
        vite: {
          build: {
            outDir: 'dist-electron',
            emptyOutDir: false,
            minify: false,
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: {
              external: ['electron', ...nodeExternals],
              output: { entryFileNames: 'preload.cjs' },
            },
          },
        },
      },
    ]),
  ],
});
