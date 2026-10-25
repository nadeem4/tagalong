/**
 * electron-vite build for the desktop app: main and the voice worker, the sandboxed preload, and
 * one renderer page per window.
 */

import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

/**
 * The renderer imports React itself, so this app declares it, at the same version as
 * @tagalong/ui. Resolving from the ui package still guarantees a single React instance in
 * the renderer, which is what matters for hooks and context.
 */
const fromUi = createRequire(new URL('../ui/package.json', import.meta.url));
const reactDir = dirname(fromUi.resolve('react/package.json'));
const reactDomDir = dirname(fromUi.resolve('react-dom/package.json'));

/**
 * The workspace packages are bundled, not externalized.
 *
 * They compile with `moduleResolution: bundler`, so their emitted relative imports carry
 * no file extension and Node's ESM loader cannot resolve them at runtime. Letting Rollup
 * inline them resolves those imports at build time, which is what an Electron app wants
 * anyway. Only their genuinely native dependencies stay external (better-sqlite3,
 * get-windows, onnxruntime-node and uiohook-napi, the talk key's hook, ship .node binaries Rollup cannot inline), and because
 * those are then resolved at runtime from this app, they are declared as its dependencies. Pure
 * JavaScript deps such as ws and the Anthropic SDK are inlined with everything else.
 */
const WORKSPACE_PACKAGES = ['@tagalong/core', '@tagalong/protocol', '@tagalong/ui'];
const NATIVE_DEPS = ['better-sqlite3', 'get-windows', 'onnxruntime-node', 'uiohook-napi'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    // ws reaches for two optional native addons, bufferutil and utf-8-validate, and
    // relies on `require` throwing when they are absent to fall back to its pure-JS
    // implementations. Vite substitutes an empty object for an absent optional peer
    // dependency instead, so nothing throws: ws installs wrappers that call
    // `bufferutil.unmask`, which is undefined, and the main process dies with
    // "bufferUtil.unmask is not a function" the first time a masked frame arrives.
    // Telling ws up front that the addons are unavailable keeps it on the JS path.
    define: {
      'process.env.WS_NO_BUFFER_UTIL': '"1"',
      'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
    },
    build: {
      // package.json `main` points at dist/main.js, so electron-vite owns dist/ and the
      // TypeScript project emits its declarations to out/ instead.
      outDir: 'dist',
      // The voice models run in their own process, whose entry sits beside main.js.
      lib: {
        entry: { main: 'src/main/index.ts', 'voice-worker': 'src/main/voice/worker/main.ts' },
      },
      rollupOptions: {
        external: NATIVE_DEPS,
        output: { entryFileNames: '[name].js', format: 'es' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES })],
    build: {
      outDir: 'dist/preload',
      emptyOutDir: false,
      lib: { entry: 'src/preload/index.ts' },
      // A sandboxed preload can only be CommonJS, while this package is ESM.
      rollupOptions: { output: { entryFileNames: 'index.cjs', format: 'cjs' } },
    },
  },
  renderer: {
    root: 'src/renderer',
    // @vitejs/plugin-react 6.1.1 imports `vite/internal`, which only exists in Vite 8,
    // and this app is pinned to Vite 7. Vite's own esbuild transform covers the JSX; the
    // only thing lost is Fast Refresh during dev.
    esbuild: { jsx: 'automatic' },
    resolve: { alias: { react: reactDir, 'react-dom': reactDomDir } },
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          avatar: 'src/renderer/avatar.html',
          panel: 'src/renderer/panel.html',
          settings: 'src/renderer/settings.html',
          welcome: 'src/renderer/welcome.html',
          home: 'src/renderer/home.html',
          pointer: 'src/renderer/pointer.html',
        },
      },
    },
  },
});
