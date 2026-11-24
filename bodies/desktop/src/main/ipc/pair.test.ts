/** Tests for pairing the desktop with a brain from a link, on a fake pinned socket. */
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import type { PinnedSocket } from '../brain/pinned-socket';
import { fakeIpc } from './fake-ipc';
import { pairWithLink, registerPairIpc } from './pair';
import type { PairDeps } from './pair';

const fp = 'ab'.repeat(32);
const link = `tagalong://pair?addr=10.0.0.5:47323&fp=${fp}&code=the-code`;

type Script = (sock: Fake) => void;
class Fake implements PinnedSocket {
  sent: Record<string, unknown>[] = [];
  mismatched = false;
  open = () => undefined as void;
  message = (_: string) => undefined as void;
  close_ = () => undefined as void;
  closed = false;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  mismatch() {
    return this.mismatched;
  }
  onOpen(f: () => void) {
    this.open = f;
  }
  onMessage(f: (d: string) => void) {
    this.message = f;
  }
  onClose(f: () => void) {
    this.close_ = f;
  }
}

function setup(script: Script, canSeal = true) {
  const saved: { link: unknown; token: string }[] = [];
  const logs: string[] = [];
  const urls: string[] = [];
  let sock: Fake | undefined;
  const deps: PairDeps = {
    link: {
      canSeal: () => canSeal,
      saveRemote: (l, token) => void saved.push({ link: l, token }),
      forget: () => undefined,
    },
    openSocket: (url) => {
      urls.push(url);
      sock = new Fake();
      queueMicrotask(() => script(sock!));
      return sock;
    },
    log: (line) => void logs.push(line),
    timeoutMs: 20,
  };
  return { deps, saved, logs, urls, sock: () => sock };
}

const reply = (sock: Fake, body: object) =>
  sock.message(JSON.stringify({ jsonrpc: '2.0', id: sock.sent[0]!.id, ...body }));

describe('pairWithLink', () => {
  it('stores the address, fingerprint and token on a good link, sending pair before anything else', async () => {
    const { deps, saved, logs, urls, sock } = setup((s) => {
      s.open();
      reply(s, { result: { device_id: 'dev-1', token: 'device-token-xyz' } });
    });
    expect(await pairWithLink(deps, link, 'My PC')).toEqual({ ok: true });
    expect(urls).toEqual(['wss://10.0.0.5:47323']);
    expect(sock()!.sent).toHaveLength(1);
    expect(sock()!.sent[0]).toMatchObject({
      method: 'pair',
      params: { code: 'the-code', device: { name: 'My PC', kind: 'desktop' } },
    });
    expect(saved).toEqual([{ link: { addrs: ['10.0.0.5:47323'], fp }, token: 'device-token-xyz' }]);
    expect(logs.join('\n')).not.toContain('device-token-xyz');
    expect(logs.join('\n')).not.toContain('the-code');
  });

  it('says wrong_brain for another certificate and stores nothing', async () => {
    const { deps, saved } = setup((s) => {
      s.mismatched = true;
      s.close_();
    });
    expect(await pairWithLink(deps, link, 'My PC')).toEqual({ ok: false, reason: 'wrong_brain' });
    expect(saved).toEqual([]);
  });

  it('says refused when the brain answers with an error and stores nothing', async () => {
    const { deps, saved } = setup((s) => {
      s.open();
      reply(s, { error: { code: -32009, message: 'unauthorized' } });
    });
    expect(await pairWithLink(deps, link, 'My PC')).toEqual({ ok: false, reason: 'refused' });
    expect(saved).toEqual([]);
  });

  it('says unreachable when nothing answers', async () => {
    const { deps, saved } = setup(() => undefined);
    expect(await pairWithLink(deps, link, 'My PC')).toEqual({ ok: false, reason: 'unreachable' });
    expect(saved).toEqual([]);
  });

  it('says cannot_seal before opening a socket when the OS cannot keep the token', async () => {
    const { deps, urls, saved } = setup(() => undefined, false);
    expect(await pairWithLink(deps, link, 'My PC')).toEqual({ ok: false, reason: 'cannot_seal' });
    expect(urls).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('says bad_link without opening a socket', async () => {
    const { deps, urls } = setup(() => undefined);
    expect(await pairWithLink(deps, 'https://example.com', 'My PC')).toEqual({
      ok: false,
      reason: 'bad_link',
    });
    expect(urls).toEqual([]);
  });
});

describe('registerPairIpc', () => {
  it('restarts the brain client after a successful pairing, not after a failed one', async () => {
    const { deps } = setup((s) => {
      s.open();
      reply(s, { result: { device_id: 'dev-1', token: 't' } });
    });
    const restarts: number[] = [];
    const ipc = fakeIpc();
    registerPairIpc(ipc.handle, {
      ...deps,
      deviceName: 'My PC',
      brain: { call: async () => [] },
      discover: async () => [],
      reconnect: () => void restarts.push(1),
    });
    await ipc.invoke(IPC.pairWithLink, 'nope');
    expect(restarts).toEqual([]);
    await ipc.invoke(IPC.pairWithLink, link);
    expect(restarts).toEqual([1]);
  });

  it('makes a pairing code on this PC’s brain and hands the page the link, expiry and QR but not the secret', async () => {
    const { deps } = setup(() => undefined);
    const asked: { tool: string; input: unknown }[] = [];
    const ipc = fakeIpc();
    registerPairIpc(ipc.handle, {
      ...deps,
      deviceName: 'My PC',
      brain: {
        call: async (tool, input) => {
          asked.push({ tool, input });
          return [
            {
              type: 'text',
              text: JSON.stringify({
                link,
                secret: 'the-code',
                expires_at: '2026-11-23T12:10:00Z',
                qr: 'QR',
              }),
            },
          ];
        },
      },
      discover: async () => [],
      reconnect: () => undefined,
    });
    expect(await ipc.invoke(IPC.pairMake)).toEqual({
      link,
      expiresAt: '2026-11-23T12:10:00Z',
      qr: 'QR',
    });
    expect(asked).toEqual([{ tool: 'pair_make', input: { kind: 'desktop' } }]);
  });
});
