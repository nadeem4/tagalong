import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrForget } from './model-cache';

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'tagalong-models-'));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

function partial(model: string): string {
  const dir = join(cacheDir, model);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'model.onnx'), 'half a file');
  return dir;
}

describe('loadOrForget', () => {
  it('returns what the loader loaded and keeps the cache', async () => {
    const dir = partial('acme/model');
    await expect(loadOrForget(cacheDir, 'acme/model', async () => 'loaded')).resolves.toBe(
      'loaded',
    );
    expect(existsSync(dir)).toBe(true);
  });

  it('deletes that model’s folder when loading fails, so the next try downloads again', async () => {
    const dir = partial('acme/model');
    const other = partial('acme/other');
    await expect(
      loadOrForget(cacheDir, 'acme/model', async () => {
        throw new Error('Protobuf parsing failed');
      }),
    ).rejects.toThrow('Protobuf parsing failed');
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(other)).toBe(true);
  });
});
