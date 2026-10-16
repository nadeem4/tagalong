/** Tests for EngineConnection: hello, heartbeat, reconnect and a rejected token. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_ERROR_CODES } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import { EngineConnection, reconnectDelay } from './engine-connection';
import type { ConnectionStatus, EngineConnectionOptions } from './engine-connection';
import type { Pairing } from './pairing';
import { FakeSocket } from './test-support/fake-socket';

const TOKEN = 'b'.repeat(64);
const SESSION = '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f';
const PET: Pet = {
  id: 'pip',
  name: 'Pip',
  avatar: '🐣',
  providerId: 'fake',
  model: 'fake-1',
  roleId: 'companion',
};

function harness(overrides: Partial<EngineConnectionOptions> = {}) {
  const sockets: FakeSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const notifications: { method: string; params: unknown }[] = [];
  let pairing: Pairing | null = { token: TOKEN, port: 47321 };
  const connection = new EngineConnection({
    readPairing: () => Promise.resolve(pairing),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    hostVersion: '0.0.0',
    capabilities: ['selection', 'pageText', 'activeWindow'],
    answer: () => Promise.resolve({ snapshot: {} }),
    onNotification: (method, params) => notifications.push({ method, params }),
    onStatus: (status) => statuses.push(status),
    ...overrides,
  });
  return {
    connection,
    sockets,
    statuses,
    notifications,
    setPairing: (next: Pairing | null) => {
      pairing = next;
    },
    latest: () => sockets[sockets.length - 1]!,
    lastStatus: () => statuses[statuses.length - 1],
  };
}

/** Lets the pairing read and other awaited microtasks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** Opens the newest socket and answers its hello the way a healthy engine does. */
async function acceptHello(h: ReturnType<typeof harness>, pets: Pet[] = [PET]): Promise<void> {
  await flush();
  const socket = h.latest();
  socket.open();
  const hello = socket.lastRequest('hello')!;
  socket.receive({
    jsonrpc: '2.0',
    id: hello.id,
    result: { sessionId: SESSION, engineVersion: '1.2.3', protocolVersion: '0.1.0', pets },
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reconnectDelay', () => {
  it('backs off exponentially from one second and caps at thirty', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 12].map(reconnectDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});

describe('EngineConnection', () => {
  it('says unpaired and opens no socket until a token is stored', async () => {
    const h = harness();
    h.setPairing(null);
    await h.connection.start();
    expect(h.sockets).toHaveLength(0);
    expect(h.lastStatus()).toEqual({ state: 'unpaired' });
  });

  it('dials the loopback engine on the paired port and sends hello with the token', async () => {
    const h = harness();
    h.setPairing({ token: TOKEN, port: 47400 });
    await h.connection.start();
    await flush();
    expect(h.latest().url).toBe('ws://127.0.0.1:47400');
    h.latest().open();
    expect(h.latest().lastRequest('hello')?.params).toEqual({
      host: 'extension',
      version: '0.0.0',
      capabilities: ['selection', 'pageText', 'activeWindow'],
      token: TOKEN,
    });
  });

  it('reports connected, with the pets, once hello succeeds', async () => {
    const h = harness();
    await h.connection.start();
    await acceptHello(h);
    expect(h.lastStatus()).toEqual({ state: 'connected', engineVersion: '1.2.3', pets: [PET] });
  });

  it('stops retrying and says so when the engine rejects the token', async () => {
    const h = harness();
    await h.connection.start();
    await flush();
    const socket = h.latest();
    socket.open();
    socket.receive({
      jsonrpc: '2.0',
      id: socket.lastRequest('hello')!.id,
      error: { code: RPC_ERROR_CODES.unauthorized, message: 'pairing token rejected' },
    });
    socket.serverClose();
    await flush();
    expect(h.lastStatus()).toMatchObject({ state: 'rejected' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('shows disconnected when the engine is down and keeps retrying with backoff', async () => {
    const h = harness();
    await h.connection.start();
    await flush();
    h.latest().fail();
    await flush();
    expect(h.lastStatus()).toEqual({
      state: 'disconnected',
      reason: 'could not reach the Tagalong app',
      retryInMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.sockets).toHaveLength(2);
    h.latest().fail();
    await flush();
    expect(h.lastStatus()).toMatchObject({ state: 'disconnected', retryInMs: 2_000 });
  });

  it('recovers when the engine comes back, and resets the backoff', async () => {
    const h = harness();
    await h.connection.start();
    await flush();
    h.latest().fail();
    await vi.advanceTimersByTimeAsync(1_000);
    await acceptHello(h);
    expect(h.lastStatus()).toMatchObject({ state: 'connected' });

    h.latest().serverClose();
    await flush();
    expect(h.lastStatus()).toMatchObject({ state: 'disconnected', retryInMs: 1_000 });
  });

  it('fails calls in flight when the socket drops, rather than leaving them hanging', async () => {
    const h = harness();
    await h.connection.start();
    await acceptHello(h);
    const call = h.connection.call('pets.list', {});
    h.latest().serverClose();
    await expect(call).rejects.toThrow(/closed/);
  });

  it('refuses a call while disconnected, naming why', async () => {
    const h = harness();
    h.setPairing(null);
    await h.connection.start();
    await expect(h.connection.call('pets.list', {})).rejects.toThrow(/not connected/);
  });

  it('validates call results against the protocol', async () => {
    const h = harness();
    await h.connection.start();
    await acceptHello(h);
    const call = h.connection.call('ask', { petId: 'pip', input: { text: 'hi' } });
    const request = h.latest().lastRequest('ask')!;
    h.latest().receive({ jsonrpc: '2.0', id: request.id, result: { turnId: 'not-a-uuid' } });
    await expect(call).rejects.toThrow();
  });

  it('answers engine requests through the answer callback', async () => {
    const answer = vi.fn(() => Promise.resolve({ snapshot: { selection: 'exact words' } }));
    const h = harness({ answer });
    await h.connection.start();
    await acceptHello(h);
    h.latest().receive({
      jsonrpc: '2.0',
      id: 'capture-1',
      method: 'perception.capture',
      params: { what: ['selection'] },
    });
    await flush();
    expect(answer).toHaveBeenCalledWith('perception.capture', { what: ['selection'] });
    expect(h.latest().sent.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'capture-1',
      result: { snapshot: { selection: 'exact words' } },
    });
  });

  it('turns a failed answer into an RPC error, so the engine can fall back at once', async () => {
    const h = harness({ answer: () => Promise.reject(new Error('no tab to read')) });
    await h.connection.start();
    await acceptHello(h);
    h.latest().receive({ jsonrpc: '2.0', id: 7, method: 'perception.readText', params: {} });
    await flush();
    expect(h.latest().sent.at(-1)).toMatchObject({ id: 7, error: { message: 'no tab to read' } });
  });

  it('passes turn notifications through and drops unknown ones', async () => {
    const h = harness();
    await h.connection.start();
    await acceptHello(h);
    h.latest().receive({
      jsonrpc: '2.0',
      method: 'turn.delta',
      params: { turnId: 'x', text: 'a' },
    });
    h.latest().receive({ jsonrpc: '2.0', method: 'made.up', params: {} });
    expect(h.notifications).toEqual([{ method: 'turn.delta', params: { turnId: 'x', text: 'a' } }]);
  });

  it('heartbeats with pets.list, which keeps the service worker alive and the pets fresh', async () => {
    const h = harness();
    await h.connection.start();
    await acceptHello(h);
    await vi.advanceTimersByTimeAsync(20_000);
    const ping = h.latest().lastRequest('pets.list')!;
    h.latest().receive({
      jsonrpc: '2.0',
      id: ping.id,
      result: { pets: [PET, { ...PET, id: 'fern', name: 'Fern' }] },
    });
    await flush();
    expect(h.lastStatus()).toMatchObject({ state: 'connected' });
    expect((h.lastStatus() as { pets: Pet[] }).pets.map((p) => p.id)).toEqual(['pip', 'fern']);
  });

  it('drops a socket whose heartbeat goes unanswered, so a wedged engine reads as down', async () => {
    const h = harness({ callTimeoutMs: 5_000 });
    await h.connection.start();
    await acceptHello(h);
    await vi.advanceTimersByTimeAsync(20_000 + 5_000);
    expect(h.latest().closedByClient).toBe(true);
    expect(h.lastStatus()).toMatchObject({ state: 'disconnected' });
  });

  it('reconnects with the new token when the pairing changes', async () => {
    const h = harness();
    await h.connection.start();
    await acceptHello(h);
    const other = 'c'.repeat(64);
    h.setPairing({ token: other, port: 47321 });
    await h.connection.restart();
    await flush();
    expect(h.sockets[0]!.closedByClient).toBe(true);
    h.latest().open();
    expect((h.latest().lastRequest('hello')!.params as { token: string }).token).toBe(other);
  });

  it('start() is idempotent while a socket is already up', async () => {
    const h = harness();
    await h.connection.start();
    await acceptHello(h);
    await h.connection.start();
    expect(h.sockets).toHaveLength(1);
  });
});
