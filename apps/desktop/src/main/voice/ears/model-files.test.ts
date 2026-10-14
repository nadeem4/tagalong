import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFiles, filesPresent, sharedEnsureFiles } from './model-files';

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

  it('reports progress after each file by bytes, ending at exactly 1', async () => {
    mkdirSync(join(dir, 'ears'), { recursive: true });
    writeFileSync(join(dir, 'ears/vad.onnx'), 'abc');
    const fetchFn = vi.fn(async () => new Response('de')) as unknown as typeof fetch;
    const fractions: number[] = [];
    await ensureFiles(dir, FILES, fetchFn, (f) => fractions.push(f));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fractions).toEqual([3 / 5, 1]);
  });

  it('reports a single 1 when every file is already there', async () => {
    mkdirSync(join(dir, 'ears'), { recursive: true });
    writeFileSync(join(dir, 'ears/vad.onnx'), 'abc');
    writeFileSync(join(dir, 'ears/stt.onnx'), 'de');
    const fractions: number[] = [];
    await ensureFiles(dir, FILES, vi.fn() as unknown as typeof fetch, (f) => fractions.push(f));
    expect(fractions).toEqual([1]);
  });

  it('keeps nothing of a failed or short download, so the next try starts clean', async () => {
    const refused = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(ensureFiles(dir, FILES, refused)).rejects.toThrow('503');
    const short = vi.fn(async () => new Response('a')) as unknown as typeof fetch;
    await expect(ensureFiles(dir, FILES, short)).rejects.toThrow('incomplete');
    expect(existsSync(join(dir, 'ears/vad.onnx'))).toBe(false);
    expect(existsSync(join(dir, 'ears/vad.onnx.part'))).toBe(false);
  });

  it('rejects at once offline, and keeps nothing', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(ensureFiles(dir, FILES, offline)).rejects.toThrow('fetch failed');
    expect(offline).toHaveBeenCalledOnce();
    expect(existsSync(join(dir, 'ears/vad.onnx'))).toBe(false);
    expect(existsSync(join(dir, 'ears/vad.onnx.part'))).toBe(false);
    expect(filesPresent(dir, FILES)).toBe(false);
  });
});

describe('sharedEnsureFiles', () => {
  it('joins a download already under way instead of fetching the same files twice', async () => {
    const opened: (() => void)[] = [];
    const fetchFn = vi.fn(
      (url: string | URL | Request) =>
        new Promise<Response>((resolve) =>
          opened.push(() => resolve(new Response(String(url).includes('vad') ? 'abc' : 'de'))),
        ),
    ) as unknown as typeof fetch;
    const ensure = sharedEnsureFiles(dir, FILES, fetchFn);
    const fractions: number[] = [];
    const prefetch = ensure((f) => fractions.push(f));
    const listen = ensure();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      opened.splice(0).forEach((open) => open());
    }
    await Promise.all([prefetch, listen]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fractions.at(-1)).toBe(1);
    expect(filesPresent(dir, FILES)).toBe(true);
  });

  it('tries afresh after a failed download', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const ensure = sharedEnsureFiles(dir, FILES, offline);
    await expect(ensure()).rejects.toThrow('fetch failed');
    await expect(ensure()).rejects.toThrow('fetch failed');
    expect(offline).toHaveBeenCalledTimes(2);
  });
});
