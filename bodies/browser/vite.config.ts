/** Vite build for the extension pages and service worker. */
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { manifest } from './src/manifest';

/** Writes the manifest object next to the bundle, so the two cannot drift. */
function emitManifest(): Plugin {
  return {
    name: 'tagalong-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

/**
 * The extension pages and service worker, built as ES modules into `dist/`, the folder Chrome
 * loads unpacked. The content script is a second build (`vite.content.config.ts`) because
 * Chrome injects it as a classic script, which cannot import the shared chunks this build makes.
 */
export default defineConfig({
  root: 'src',
  plugins: [emitManifest()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Chrome loads files from disk; inlining nothing keeps every asset under the CSP.
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: {
      input: {
        permission: 'src/permission/permission.html',
        popup: 'src/popup/popup.html',
        'service-worker': 'src/service-worker.ts',
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' ? 'service-worker.js' : 'assets/[name]-[hash].js',
      },
    },
  },
});
