import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EARS_FILES,
  ensureFiles,
  filesPresent,
  KOKORO_FILES,
  ModelIntegrityError,
  sharedEnsureFiles,
} from './model-files';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-ears-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const FILES = [
  { url: 'https://example.test/vad.onnx', path: 'ears/vad.onnx', bytes: 3, sha256: sha256('abc') },
  { url: 'https://example.test/stt.onnx', path: 'ears/stt.onnx', bytes: 2, sha256: sha256('de') },
];
/** Answers each URL with the next body in its list, then keeps repeating the last. */
function serve(bodies: Record<string, string[]>) {
  return vi.fn(async (url: string | URL | Request) => {
    const name = String(url).includes('vad') ? 'vad' : 'stt';
    const list = bodies[name]!;
    return new Response(list.length > 1 ? list.shift() : list[0]);
  }) as unknown as typeof fetch;
}

describe('the pinned model lists', () => {
  it('pins every file to a commit and a SHA-256, never to a moving branch', () => {
    for (const file of [...EARS_FILES, ...KOKORO_FILES]) {
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
      expect(file.url, file.path).toMatch(
        /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//,
      );
      expect(file.url, file.path).not.toContain('/resolve/main/');
      expect(file.bytes, file.path).toBeGreaterThan(0);
    }
  });

  it('keeps Kokoro in the transformers.js cache layout, with its weights', () => {
    expect(KOKORO_FILES.map((f) => f.path)).toContain(
      'onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model_quantized.onnx',
    );
    for (const file of KOKORO_FILES)
      expect(file.url.endsWith(file.path.replace('onnx-community/Kokoro-82M-v1.0-ONNX/', ''))).toBe(
        true,
      );
  });
});

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
    await expect(ensureFiles(dir, FILES, short)).rejects.toThrow(ModelIntegrityError);
    expect(existsSync(join(dir, 'ears/vad.onnx'))).toBe(false);
    expect(existsSync(join(dir, 'ears/vad.onnx.part'))).toBe(false);
  });

  it('fetches a damaged download once more and keeps the good copy', async () => {
    const fetchFn = serve({ vad: ['abX', 'abc'], stt: ['de'] });
    await ensureFiles(dir, FILES, fetchFn);
    expect(readFileSync(join(dir, 'ears/vad.onnx'), 'utf8')).toBe('abc');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('gives up with a damaged-model error after two bad copies, and keeps nothing', async () => {
    const fetchFn = serve({ vad: ['abX'], stt: ['de'] });
    const failure = ensureFiles(dir, FILES, fetchFn);
    await expect(failure).rejects.toBeInstanceOf(ModelIntegrityError);
    await expect(failure).rejects.toThrow(/damaged|checksum/);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(existsSync(join(dir, 'ears/vad.onnx'))).toBe(false);
    expect(existsSync(join(dir, 'ears/vad.onnx.part'))).toBe(false);
  });

  it('replaces a corrupt file already on disk, and keeps a good one', async () => {
    mkdirSync(join(dir, 'ears'), { recursive: true });
    writeFileSync(join(dir, 'ears/vad.onnx'), 'xyz');
    writeFileSync(join(dir, 'ears/stt.onnx'), 'de');
    const fetchFn = serve({ vad: ['abc'], stt: ['de'] });
    await ensureFiles(dir, FILES, fetchFn);
    expect(readFileSync(join(dir, 'ears/vad.onnx'), 'utf8')).toBe('abc');
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('deletes a corrupt file on disk even when the fresh copy cannot be fetched', async () => {
    mkdirSync(join(dir, 'ears'), { recursive: true });
    writeFileSync(join(dir, 'ears/vad.onnx'), 'xyz');
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(ensureFiles(dir, FILES, offline)).rejects.toThrow('fetch failed');
    expect(existsSync(join(dir, 'ears/vad.onnx'))).toBe(false);
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

  it('checks the files on disk once per process, not on every listen', async () => {
    const fetchFn = serve({ vad: ['abc'], stt: ['de'] });
    const ensure = sharedEnsureFiles(dir, FILES, fetchFn);
    await ensure();
    writeFileSync(join(dir, 'ears/vad.onnx'), 'xyz');
    const fractions: number[] = [];
    await ensure((f) => fractions.push(f));
    expect(fractions).toEqual([1]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(dir, 'ears/vad.onnx'), 'utf8')).toBe('xyz');
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
