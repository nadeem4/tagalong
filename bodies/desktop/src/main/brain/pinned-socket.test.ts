/**
 * Tests for the pinned wss socket against a real local TLS server. The fixtures in
 * fixtures/ are throwaway self-signed pairs made for these tests only; they protect nothing.
 */
import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrainSocket } from '@tagalong/contract';
import { pinnedSocket } from './pinned-socket';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pem = (name: string) => readFileSync(join(dir, `${name}.pem`));
const fingerprintOf = (cert: Buffer) =>
  createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

async function serve(cert: string, key: string) {
  const https = createServer({ cert: pem(cert), key: pem(key) });
  const wss = new WebSocketServer({ server: https });
  await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    wss.clients.forEach((c) => c.terminate());
    https.close();
  });
  return { port: (https.address() as AddressInfo).port };
}

/** Resolves "open" or "closed", whichever the socket reaches first. */
function outcome(sock: BrainSocket): Promise<'open' | 'closed'> {
  return new Promise((resolve) => {
    sock.onOpen(() => resolve('open'));
    sock.onClose(() => resolve('closed'));
    closers.push(() => sock.close());
  });
}

describe('pinnedSocket', () => {
  it('connects when the fingerprint matches, in either letter case', async () => {
    const s = await serve('cert', 'key');
    const pin = fingerprintOf(pem('cert'));
    expect(await outcome(pinnedSocket(`wss://127.0.0.1:${s.port}`, pin))).toBe('open');
    expect(await outcome(pinnedSocket(`wss://127.0.0.1:${s.port}`, pin.toUpperCase()))).toBe(
      'open',
    );
  });

  it('refuses a brain with another certificate', async () => {
    const s = await serve('other-cert', 'other-key');
    const sock = pinnedSocket(`wss://127.0.0.1:${s.port}`, fingerprintOf(pem('cert')));
    expect(await outcome(sock)).toBe('closed');
  });

  it('refuses a ws:// url and a malformed pin', () => {
    expect(() => pinnedSocket('ws://127.0.0.1:1', 'a'.repeat(64))).toThrow();
    expect(() => pinnedSocket('wss://127.0.0.1:1', 'xyz')).toThrow();
  });
});
