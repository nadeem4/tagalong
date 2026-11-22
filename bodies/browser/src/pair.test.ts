/**
 * Pairing the add-on with a short code: it goes to this machine's brain only, sends the code
 * as a `pair` request, and hands back the token the brain issues.
 */
import { describe, expect, it } from 'vitest';
import { pairBrowser } from './pair';
import { FakeBrainSocket, settle } from './test-support/fake-brain-socket';

function setup(addr = '127.0.0.1:47321') {
  const sockets: FakeBrainSocket[] = [];
  const deps = {
    addr,
    name: 'Chrome',
    timeoutMs: 20,
    openSocket: (url: string) => {
      const s = new FakeBrainSocket(url);
      sockets.push(s);
      return s;
    },
  };
  return { sockets, pair: (code: string) => pairBrowser(deps, code) };
}

describe('pairBrowser', () => {
  it('sends the code over loopback and returns the token', async () => {
    const { sockets, pair } = setup();
    const done = pair('123456');
    const socket = sockets[0]!;
    socket.open();
    expect(socket.url).toBe('ws://127.0.0.1:47321');
    expect(socket.request('pair')?.['params']).toEqual({
      code: '123456',
      device: { name: 'Chrome', kind: 'browser' },
    });
    socket.receive({
      jsonrpc: '2.0',
      id: socket.request('pair')?.['id'],
      result: { device_id: 'd1', token: 'tok' },
    });
    expect(await done).toEqual({ ok: true, token: 'tok' });
  });

  it('is refused by the brain', async () => {
    const { sockets, pair } = setup();
    const done = pair('123456');
    const socket = sockets[0]!;
    socket.open();
    socket.receive({
      jsonrpc: '2.0',
      id: socket.request('pair')?.['id'],
      error: { code: -32009, message: 'That code did not work.' },
    });
    expect(await done).toEqual({ ok: false });
  });

  it('gives up when the brain does not answer', async () => {
    const { sockets, pair } = setup();
    const done = pair('123456');
    sockets[0]!.open();
    await settle();
    expect(await done).toEqual({ ok: false });
  });

  it('opens no socket for a code that is not six digits', async () => {
    const { sockets, pair } = setup();
    expect(await pair('12345')).toEqual({ ok: false });
    expect(sockets).toEqual([]);
  });

  it('never dials an address that is not this machine', async () => {
    const { sockets, pair } = setup('192.168.1.5:47321');
    expect(await pair('123456')).toEqual({ ok: false });
    expect(sockets).toEqual([]);
  });
});
