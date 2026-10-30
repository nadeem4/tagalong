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
 * The extension pages and the service worker, built as ES modules into `dist/`, which is
 * the folder Chrome loads unpacked. The content script is a second build
 * (`vite.content.config.ts`) because Chrome injects it as a classic script, which cannot
 * import the shared chunks this build produces.
 */
export default defineConfig({
  root: 'src',
  // Vite's own esbuild transform covers the JSX, as in the desktop renderer; the React
  // plugin pinned in this workspace needs a newer Vite than the one installed.
  esbuild: { jsx: 'automatic' },
  plugins: [emitManifest()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // Chrome loads files from disk; inlining nothing keeps every asset under the CSP.
    assetsInlineLimit: 0,
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: 'src/sidepanel.html',
        options: 'src/options.html',
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
