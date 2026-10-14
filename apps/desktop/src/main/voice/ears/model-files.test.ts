import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFiles, filesPresent } from './model-files';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-ears-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const FILES = [
  { url: 'https://example.test/vad.onnx', path: 'ears/vad.onnx', bytes: 3 },
  { url: 'https://example.test/stt.onnx', path: 'ears/stt.onnx', bytes: 2 },
];

describe('ensureFiles', () => {
  it('downloads each missing file once, and nothing when all are there', async () => {
    const fetchFn = vi.fn(
      async (url: string | URL | Request) =>
        new Response(String(url).includes('vad') ? 'abc' : 'de'),
    ) as unknown as typeof fetch;
    expect(filesPresent(dir, FILES)).toBe(false);
    await ensureFiles(dir, FILES, fetchFn);
    expect(readFileSync(join(dir, 'ears/vad.onnx'), 'utf8')).toBe('abc');
    expect(filesPresent(dir, FILES)).toBe(true);
    await ensureFiles(dir, FILES, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps nothing of a failed or short download, so the next try starts clean', async () => {
    const refused = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(ensureFiles(dir, FILES, refused)).rejects.toThrow('503');
    const short = vi.fn(async () => new Response('a')) as unknown as typeof fetch;
    await expect(ensureFiles(dir, FILES, short)).rejects.toThrow('incomplete');
    expect(existsSync(join(dir, 'ears/vad.onnx'))).toBe(false);
    expect(existsSync(join(dir, 'ears/vad.onnx.part'))).toBe(false);
  });
});
