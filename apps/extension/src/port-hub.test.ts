import { describe, expect, it, vi } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { PortHub } from './port-hub';
import type { PortLike, WorkerMessage } from './port-messages';

function fakePort() {
  const listeners: ((message: unknown) => void)[] = [];
  const disconnects: (() => void)[] = [];
  const posted: WorkerMessage[] = [];
  const port: PortLike & { posted: WorkerMessage[]; send(m: unknown): void; drop(): void } = {
    posted,
    postMessage: (message) => posted.push(message as WorkerMessage),
    onMessage: { addListener: (l) => listeners.push(l) },
    onDisconnect: { addListener: (l) => disconnects.push(l) },
    send: (message) => listeners.forEach((l) => l(message)),
    drop: () => disconnects.forEach((l) => l()),
  };
  return port;
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const SNAPSHOT: ContextSnapshot = {
  id: '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
  capturedAt: '2026-10-04T00:00:00.000Z',
  host: 'extension',
  selection: 'exact words',
};

function hub(overrides: Partial<ConstructorParameters<typeof PortHub>[0]> = {}) {
  return new PortHub({
    status: () => ({ state: 'unpaired' }),
    call: vi.fn(() => Promise.resolve({ pets: [] })),
    capture: vi.fn(() => Promise.resolve(SNAPSHOT)),
    ...overrides,
  });
}

describe('PortHub', () => {
  it('tells a newly opened page the connection state at once', () => {
    const h = hub({ status: () => ({ state: 'connecting' }) });
    const port = fakePort();
    h.add(port);
    expect(port.posted).toEqual([{ type: 'status', status: { state: 'connecting' } }]);
  });

  it('broadcasts to every open page and stops at the ones that closed', () => {
    const h = hub();
    const a = fakePort();
    const b = fakePort();
    h.add(a);
    h.add(b);
    b.drop();
    h.broadcast({ type: 'status', status: { state: 'unpaired' } });
    expect(a.posted).toHaveLength(2);
    expect(b.posted).toHaveLength(1);
  });

  it('forwards a call to the engine and replies on the same port', async () => {
    const call = vi.fn(() => Promise.resolve({ pets: [] }));
    const h = hub({ call });
    const port = fakePort();
    h.add(port);
    port.send({ type: 'call', id: 3, method: 'pets.list', params: {} });
    await flush();
    expect(call).toHaveBeenCalledWith('pets.list', {});
    expect(port.posted.at(-1)).toEqual({ type: 'reply', id: 3, ok: true, result: { pets: [] } });
  });

  it('replies with the error text when the engine call fails', async () => {
    const h = hub({ call: () => Promise.reject(new Error('not connected to the Tagalong app')) });
    const port = fakePort();
    h.add(port);
    port.send({ type: 'call', id: 4, method: 'pets.list', params: {} });
    await flush();
    expect(port.posted.at(-1)).toEqual({
      type: 'reply',
      id: 4,
      ok: false,
      error: 'not connected to the Tagalong app',
    });
  });

  it('answers a capture with the snapshot read from the tab', async () => {
    const capture = vi.fn(() => Promise.resolve(SNAPSHOT));
    const h = hub({ capture });
    const port = fakePort();
    h.add(port);
    port.send({ type: 'capture', id: 5, targets: ['selection', 'pageText'] });
    await flush();
    expect(capture).toHaveBeenCalledWith(['selection', 'pageText']);
    expect(port.posted.at(-1)).toEqual({ type: 'reply', id: 5, ok: true, result: SNAPSHOT });
  });

  it('ignores pings and anything it does not recognise', async () => {
    const call = vi.fn();
    const h = hub({ call });
    const port = fakePort();
    h.add(port);
    port.send({ type: 'ping' });
    port.send({ type: 'nonsense' });
    port.send('not even an object');
    await flush();
    expect(call).not.toHaveBeenCalled();
    expect(port.posted).toHaveLength(1);
  });

  it('holds the last shortcut context for a panel that opens after it was captured', () => {
    const h = hub();
    h.publishContext(SNAPSHOT);
    const port = fakePort();
    h.add(port);
    expect(port.posted).toContainEqual({ type: 'context', snapshot: SNAPSHOT });
    // Delivered once: a later panel does not get yesterday's selection.
    const later = fakePort();
    h.add(later);
    expect(later.posted.some((m) => m.type === 'context')).toBe(false);
  });
});
