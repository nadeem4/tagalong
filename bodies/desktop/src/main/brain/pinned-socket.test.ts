/**
 * Tests for the pinned wss socket against a real local TLS server. The certificates are
 * generated in memory per run, so no key is ever committed.
 */
import { createHash, X509Certificate } from 'node:crypto';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { generate } from 'selfsigned';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { pinnedSocket } from './pinned-socket';
import type { PinnedSocket } from './pinned-socket';

interface Identity {
  cert: string;
  key: string;
  pin: string;
}

async function identity(): Promise<Identity> {
  const { cert, private: key } = await generate([{ name: 'commonName', value: '127.0.0.1' }]);
  const pin = createHash('sha256').update(new X509Certificate(cert).raw).digest('hex');
  return { cert, key, pin };
}

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((close) => close()));

async function serve({ cert, key }: Pick<Identity, 'cert' | 'key'>) {
  let requests = 0;
  const https = createServer({ cert, key });
  https.on('request', () => requests++);
  https.on('upgrade', () => requests++);
  const wss = new WebSocketServer({ server: https });
  await new Promise<void>((resolve) => https.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    wss.clients.forEach((c) => c.terminate());
    https.close();
  });
  return { port: (https.address() as AddressInfo).port, requests: () => requests };
}

/** Resolves "open" or "closed", whichever the socket reaches first. */
function outcome(sock: PinnedSocket): Promise<'open' | 'closed'> {
  return new Promise((resolve) => {
    sock.onOpen(() => resolve('open'));
    sock.onClose(() => resolve('closed'));
    closers.push(() => sock.close());
  });
}

describe('pinnedSocket', () => {
  it('connects when the fingerprint matches, in either letter case', async () => {
    const { pin, ...pair } = await identity();
    const s = await serve(pair);
    expect(await outcome(pinnedSocket(`wss://127.0.0.1:${s.port}`, pin))).toBe('open');
    expect(await outcome(pinnedSocket(`wss://127.0.0.1:${s.port}`, pin.toUpperCase()))).toBe(
      'open',
    );
  });

  it('refuses a brain with another certificate', async () => {
    const [trusted, other] = [await identity(), await identity()];
    const s = await serve(other);
    const sock = pinnedSocket(`wss://127.0.0.1:${s.port}`, trusted.pin);
    expect(await outcome(sock)).toBe('closed');
    expect(sock.mismatch()).toBe(true);
    expect(s.requests()).toBe(0);
  });

  it('does not call a dead address a different brain', async () => {
    const sock = pinnedSocket('wss://127.0.0.1:1', (await identity()).pin);
    expect(await outcome(sock)).toBe('closed');
    expect(sock.mismatch()).toBe(false);
  });

  it('refuses a ws:// url', () => {
    expect(() => pinnedSocket('ws://127.0.0.1:1', 'a'.repeat(64))).toThrow();
  });
});
