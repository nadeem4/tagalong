#!/usr/bin/env node
/* global console, process */
/**
 * Starts the app as on a new install: on a data folder of its own in the temp directory,
 * so a first run shows every time. Your real data in
 * %APPDATA%\Tagalong (settings, the database, saved keys) is never touched.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** electron-vite hands everything after `--` to Electron. */
export function previewArgs(dataDir) {
  return ['preview', '--', `--user-data-dir=${dataDir}`];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dataDir = mkdtempSync(join(tmpdir(), 'tagalong-fresh-'));
  console.log(`Starting fresh, with its data in ${dataDir}`);
  // Run electron-vite's own entry with node, not through a shell, so a path with a space
  // in it (a user name, say) reaches Electron in one piece.
  const require = createRequire(import.meta.url);
  const cli = join(
    dirname(require.resolve('electron-vite/package.json')),
    'bin',
    'electron-vite.js',
  );
  const result = spawnSync(process.execPath, [cli, ...previewArgs(dataDir)], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
