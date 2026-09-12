#!/usr/bin/env node
/* global console, process */
/**
 * Fetches the Electron binary if it is missing.
 *
 * electron@44 publishes no npm install script, so `pnpm install` unpacks the package
 * without ever downloading the platform binary — and the first `dev` run then dies with
 * a message that reads like a broken machine rather than a missing download. Running the
 * package's own install.js is exactly what the install script used to do.
 *
 * The package is resolved rather than guessed at, so this keeps working across pnpm store
 * layouts and Electron upgrades.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('electron/package.json'));
const distDir = join(packageDir, 'dist');

if (existsSync(distDir)) {
  console.log(`electron binary already unpacked in ${distDir}`);
  process.exit(0);
}

console.log(`electron binary missing; running ${join(packageDir, 'install.js')}`);
const result = spawnSync(process.execPath, [join(packageDir, 'install.js')], {
  cwd: packageDir,
  stdio: 'inherit',
});

if (result.error !== undefined) throw result.error;
if (result.status !== 0) {
  console.error('could not fetch the electron binary');
}
process.exit(result.status ?? 1);
