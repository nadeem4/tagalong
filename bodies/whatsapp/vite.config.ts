/**
 * Bundles the bridge into one file, dist/index.js. The contract package and zod are inlined
 * so the file runs on Tagalong's own Node with no node_modules next to it.
 */
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: 'src/index.ts',
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { entryFileNames: 'index.js', inlineDynamicImports: true },
    },
  },
});
