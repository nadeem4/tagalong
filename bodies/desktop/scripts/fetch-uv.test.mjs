/**
 * Tests for fetch-uv: the pinned download is verified, retried once, and never trusted
 * unchecked. Runs on a fake fetch, so no network is touched.
 */
/* global Buffer, Response */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { downloadVerified, UV_SHA256, UV_VERSION } from './fetch-uv.mjs';

const bytes = Buffer.from('pretend zip');
const sha = createHash('sha256').update(bytes).digest('hex');
const ok = () => Promise.resolve(new Response(bytes));
const bad = () => Promise.resolve(new Response(Buffer.from('tampered')));

describe('fetch-uv pin', () => {
  it('pins a version and a 64 hex sha256', () => {
    expect(UV_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(UV_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('downloadVerified', () => {
  it('returns the bytes when the hash matches', async () => {
    const out = await downloadVerified('u', sha, ok);
    expect(out.equals(bytes)).toBe(true);
  });

  it('retries once after a hash mismatch, then succeeds', async () => {
    const calls = [bad, ok];
    let n = 0;
    const out = await downloadVerified('u', sha, () => calls[n++]());
    expect(n).toBe(2);
    expect(out.equals(bytes)).toBe(true);
  });

  it('fails after the one retry when the hash keeps mismatching', async () => {
    let n = 0;
    await expect(
      downloadVerified('u', sha, () => {
        n++;
        return bad();
      }),
    ).rejects.toThrow(/sha256/);
    expect(n).toBe(2);
  });

  it('retries once after a failed request', async () => {
    let n = 0;
    const out = await downloadVerified('u', sha, () =>
      n++ === 0 ? Promise.reject(new Error('offline')) : ok(),
    );
    expect(out.equals(bytes)).toBe(true);
  });

  it('treats an HTTP error as a failure', async () => {
    await expect(
      downloadVerified('u', sha, () => Promise.resolve(new Response('', { status: 404 }))),
    ).rejects.toThrow(/404/);
  });
});
