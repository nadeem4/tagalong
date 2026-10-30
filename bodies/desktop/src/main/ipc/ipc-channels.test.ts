/**
 * Guard against dead IPC: every channel in IPC must be wired on both sides, a handler or sender
 * in main and a call in the preload. A channel with one side only is left over from a feature
 * that was deleted, and this fails until it is removed from shared/ipc.ts.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';

const SRC = join(__dirname, '..', '..');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

const main = sources(join(SRC, 'main'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');
const preload = readFileSync(join(SRC, 'preload', 'index.ts'), 'utf8');

describe('IPC channels', () => {
  it.each(Object.keys(IPC))('%s is used by main and by the preload', (key) => {
    const used = new RegExp(`IPC\\.${key}\\b`);
    expect({ main: used.test(main), preload: used.test(preload) }).toEqual({
      main: true,
      preload: true,
    });
  });
});
