/** Tests for the installer config and the desktop's runtime dependencies. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The installer config is data, so it is checked like data. A packaging mistake only shows
 * on the machine that runs the installer, which is the worst place to learn that the SQLite
 * binary stayed inside app.asar.
 */
const read = (path: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

interface BuilderConfig {
  appId: string;
  productName: string;
  directories: { output: string; buildResources: string };
  files: string[];
  asar: boolean;
  asarUnpack: string[];
  npmRebuild: boolean;
  extraResources: { from: string; to: string }[];
  win: { target: { target: string; arch: string[] }[] };
  nsis: { oneClick: boolean; perMachine: boolean; runAfterFinish: boolean };
  mac: { target: string[] };
  linux: { target: string[] };
}

const config = read('../../electron-builder.json') as BuilderConfig;
const manifest = read('../../package.json') as {
  productName: string;
  main: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

describe('electron-builder config', () => {
  it('builds an x64 NSIS installer for Windows, the target judges will run', () => {
    expect(config.win.target).toContainEqual({ target: 'nsis', arch: ['x64'] });
  });

  it('installs per user without admin rights and starts the app when done', () => {
    expect(config.nsis.oneClick).toBe(false);
    expect(config.nsis.perMachine).toBe(false);
    expect(config.nsis.runAfterFinish).toBe(true);
  });

  it('keeps the product name, so the installed app finds the same user data folder', () => {
    expect(config.productName).toBe(manifest.productName);
  });

  it('ships only the built app: the bundled main, preload and renderer', () => {
    expect(config.files).toContain('dist/**/*');
    expect(manifest.main.startsWith('./dist/')).toBe(true);
  });

  it('unpacks every native binary out of app.asar, where Node cannot load it', () => {
    expect(config.asar).toBe(true);
    expect(config.asarUnpack).toContain('**/*.node');
  });

  it('unpacks the DLLs the voice’s native modules load from beside their .node files', () => {
    expect(config.asarUnpack).toContain('**/node_modules/onnxruntime-node/bin/**');
    expect(config.asarUnpack).toContain('**/node_modules/@img/**');
  });

  it('does not rebuild native modules: every one ships an N-API binary Electron loads as is', () => {
    expect(config.npmRebuild).toBe(false);
  });

  it('ships the built Chrome extension next to app.asar, for Load unpacked', () => {
    expect(config.extraResources).toContainEqual({
      from: '../../apps/extension/dist',
      to: 'extension',
    });
  });

  it('marks the macOS and Linux targets as configured, not verified', () => {
    expect(config.mac.target).toEqual(['dmg']);
    expect(config.linux.target).toEqual(['AppImage', 'deb']);
  });

  it('keeps build output out of the dist folder electron-vite owns', () => {
    expect(config.directories.output).toBe('release');
  });
});

describe('desktop runtime dependencies', () => {
  it('lists only what the packaged app loads at runtime: the native modules and the voice', () => {
    // The workspace packages are bundled into dist/main.js by electron-vite, so listing
    // them as dependencies would make electron-builder copy their whole trees again.
    // The local voice (kokoro-js on transformers and onnxruntime-node) is loaded lazily at
    // runtime, so it stays external too.
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@huggingface/transformers',
      '@nut-tree-fork/nut-js',
      'better-sqlite3',
      'get-windows',
      'kokoro-js',
      'onnxruntime-node',
      'uiohook-napi',
    ]);
    // The version @huggingface/transformers pins, so one onnxruntime runs in the voice process.
    expect(manifest.dependencies['onnxruntime-node']).toBe('1.21.0');
    expect(manifest.devDependencies['@tagalong/core']).toBe('workspace:*');
  });

  it('keeps the talk key hook external, so its prebuilt binary loads from outside app.asar', () => {
    const viteConfig = readFileSync(
      fileURLToPath(new URL('../../electron.vite.config.ts', import.meta.url)),
      'utf8',
    );
    expect(viteConfig).toMatch(/NATIVE_DEPS = \[[^\]]*'uiohook-napi'/);
    // Its prebuilds are .node files, which every native binary's unpack rule covers.
    expect(config.asarUnpack).toContain('**/*.node');
  });

  it('has a one-command Windows installer build', () => {
    expect(manifest.scripts['package:win']).toContain('--win nsis');
    // The active-window binding is downloaded, never compiled, before the build.
    expect(manifest.scripts['package:win']).toContain('fetch-native.mjs win32 x64');
  });
});
