/**
 * The page reader, injected on demand with `chrome.scripting.executeScript`.
 *
 * A single classic script with every import inlined: an injected file cannot load
 * modules from the extension, so Readability has to travel inside it.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: 'src/content/page-reader.ts',
      formats: ['iife'],
      name: 'tagalongPageReader',
      fileName: () => 'page-reader.js',
    },
  },
});
