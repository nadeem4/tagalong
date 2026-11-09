#!/usr/bin/env node
/* global Buffer, console, fetch, process */
/**
 * Fetches the pinned uv.exe the installer carries, so a fresh machine can build the brain's
 * Python environment on first start without Python or uv installed.
 *
 * The version and sha256 are pinned (from astral-sh/uv's release .sha256 file): a changed
 * download fails the build instead of shipping. One retry covers a flaky network.
 *
 * Usage: node scripts/fetch-uv.mjs   (writes build/uv/uv.exe; exits 1 on failure)
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UV_VERSION = '0.13.7';
export const UV_SHA256 = '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021';
const ZIP = 'uv-x86_64-pc-windows-msvc.zip';
export const UV_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${ZIP}`;

/** Downloads url and checks its sha256; one retry on any failure. fetchFn is injectable. */
export async function downloadVerified(url, sha256, fetchFn = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      const actual = createHash('sha256').update(body).digest('hex');
      if (actual !== sha256) {
        throw new Error(`sha256 mismatch: expected ${sha256}, got ${actual}`);
      }
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = join(here, '..', 'build', 'uv');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  console.log(`fetching uv ${UV_VERSION}`);
  const zip = join(out, ZIP);
  writeFileSync(zip, await downloadVerified(UV_URL, UV_SHA256));
  // Windows' own bsdtar reads zip. Named by full path because Git Bash puts GNU tar first on
  // PATH, which cannot read zip.
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? String.raw`C:\Windows`, 'System32', 'tar.exe')
      : 'tar';
  const result = spawnSync(tar, ['-xf', ZIP], { cwd: out, stdio: 'inherit' });
  rmSync(zip, { force: true });
  if (result.status !== 0 || !existsSync(join(out, 'uv.exe'))) {
    throw new Error('could not extract uv.exe');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`fetch-uv: ${error.message}`);
    process.exit(1);
  });
}
