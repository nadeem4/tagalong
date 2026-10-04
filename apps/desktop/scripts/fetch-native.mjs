#!/usr/bin/env node
/* global console, process */
/**
 * Fetches get-windows' prebuilt Windows binding before an installer is built.
 *
 * pnpm skips get-windows' install script (it is in `pnpm.ignoredBuiltDependencies`, so no
 * install ever compiles anything), which also skips the step that downloads its prebuilt
 * N-API binary. Without that file the active-window lookup quietly answers "no window" and
 * a look falls back to the whole screen. This runs the same download the install script
 * would have, without `--fallback-to-build`, so it never needs a C++ toolchain.
 *
 * Usage: node scripts/fetch-native.mjs [platform] [arch]   (defaults: win32 x64)
 *
 * A failure is a warning, not an error: the app still works without the binding.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const [platform = 'win32', arch = 'x64'] = process.argv.slice(2);

const require = createRequire(import.meta.url);
// get-windows' exports map hides package.json, so resolve its entry point instead.
const packageDir = dirname(require.resolve('get-windows'));
const fromGetWindows = createRequire(join(packageDir, 'package.json'));
const preGyp = join(
  dirname(fromGetWindows.resolve('@mapbox/node-pre-gyp/package.json')),
  'bin',
  'node-pre-gyp',
);

console.log(`fetching the get-windows binding for ${platform}-${arch}`);
const result = spawnSync(
  process.execPath,
  [
    preGyp,
    'install',
    `--target_platform=${platform}`,
    `--target_arch=${arch}`,
    // node-pre-gyp names Windows builds "unknown" libc; from a Linux machine it would
    // otherwise ask for a glibc Windows build, which does not exist.
    ...(platform === 'win32' ? ['--target_libc=unknown'] : []),
  ],
  { cwd: packageDir, stdio: 'inherit' },
);

if (result.error !== undefined || result.status !== 0) {
  console.warn(
    'could not fetch the get-windows binding; the installer still builds, but the app ' +
      'will not know the active window and a look will capture the whole screen',
  );
}
process.exit(0);
