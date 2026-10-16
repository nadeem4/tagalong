/** Tests for EngineServer: pairing, extension scoping, RPC routing and the perception requests. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, RPC_ERROR_CODES } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import { EXTENSION_METHODS, EngineServer, RpcFailure } from './ws-server';
import type { EngineServerOptions, HostSession } from './ws-server';

const TOKEN = 'a'.repeat(64);

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  model: 'claude-sonnet-5',
  providerId: 'anthropic',
  roleId: 'companion',
};

let server: EngineServer | undefined;
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  server = undefined;
});

async function start(overrides: Partial<EngineServerOptions> = {}): Promise<EngineServer> {
  server = await EngineServer.start({
    // Port 0 lets the OS pick a free port, so tests never collide with a real engine.
    port: 0,
    token: TOKEN,
    engineVersion: '0.0.0-test',
    listPets: () => [SCOUT],
    handlers: {},
    ...overrides,
  });
  return server;
}

/** A minimal JSON-RPC client so the tests exercise the real wire format. */
class TestClient {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<number, (msg: Record<string, unknown>) => void>();
  /** A parse error is answered with id null, so it cannot be matched by id. */
  #anyResponse: ((msg: Record<string, unknown>) => void) | undefined;
  readonly notifications: { method: string; params: unknown }[] = [];
  /** Answers core-to-host requests such as perception.capture. */
  onRequest: ((method: string, params: unknown) => unknown) | undefined;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (raw) => this.#receive(String(raw)));
  }

  static async connect(port: number): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return new TestClient(socket);
  }

  #receive(raw: string): void {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    // A core-to-host request: it carries both an id and a method, and its id may be
    // a string, so it cannot be told apart by id type alone.
    if ('method' in msg && 'id' in msg) {
      const answer = this.onRequest?.(String(msg['method']), msg['params']);
      this.send({ jsonrpc: '2.0', id: msg['id'], result: answer });
      return;
    }
    if ('id' in msg) {
      const resolve = this.#pending.get(msg['id'] as number);
      if (resolve !== undefined) {
        this.#pending.delete(msg['id'] as number);
        resolve(msg);
      } else {
        const any = this.#anyResponse;
        this.#anyResponse = undefined;
        any?.(msg);
      }
      return;
    }
    this.notifications.push({ method: String(msg['method']), params: msg['params'] });
  }

  send(payload: unknown): void {
    this.#socket.send(JSON.stringify(payload));
  }

  call(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Sends bytes the server cannot parse, so the reply arrives with id null. */
  sendRaw(text: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      this.#anyResponse = resolve;
      this.#socket.send(text);
    });
  }

  closed(): Promise<void> {
    return new Promise((resolve) => this.#socket.once('close', () => resolve()));
  }
}

const hello = (token = TOKEN) => ({
  host: 'desktop' as const,
  version: '0.0.0',
  capabilities: ['selection', 'activeWindow'] as const,
  token,
});

describe('pairing', () => {
  it('accepts a host that presents the right token', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);

    const res = await client.call('hello', hello());
    const result = res['result'] as Record<string, unknown>;

    expect(res['error']).toBeUndefined();
    expect(result['engineVersion']).toBe('0.0.0-test');
    expect(result['protocolVersion']).toBe(PROTOCOL_VERSION);
    expect(result['pets']).toHaveLength(1);
    expect(String(result['sessionId'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a wrong token and closes the socket', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);

    const res = await client.call('hello', hello('b'.repeat(64)));

    expect((res['error'] as Record<string, unknown>)['code']).toBe(RPC_ERROR_CODES.unauthorized);
    await client.closed();
    expect(s.sessions()).toHaveLength(0);
  });

  it('refuses any other method before hello', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);

    const res = await client.call('pets.list', {});

    expect((res['error'] as Record<string, unknown>)['code']).toBe(RPC_ERROR_CODES.unauthorized);
  });
});

describe('host scoping', () => {
  const extensionHello = {
    host: 'extension' as const,
    version: '0.0.0',
    capabilities: ['selection', 'pageText', 'activeWindow'] as const,
    token: TOKEN,
  };

  it('lets the extension call only what its side panel uses', async () => {
    const turnId = '11111111-2222-4333-8444-555555555555';
    const s = await start({
      handlers: {
        ask: () => ({ turnId }),
        'settings.set': () => {
          throw new Error('must not run');
        },
      },
    });
    const client = await TestClient.connect(s.port);
    await client.call('hello', extensionHello);

    const asked = await client.call('ask', { petId: 'scout', input: { text: 'hi' } });
    expect((asked['result'] as Record<string, unknown>)['turnId']).toBe(turnId);

    for (const method of [
      'settings.set',
      'tool.approve',
      'connections.add',
      'routines.save',
      'experts.upsert',
      'handoffs.confirm',
    ]) {
      const res = await client.call(method, {});
      expect((res['error'] as Record<string, unknown>)['code']).toBe(RPC_ERROR_CODES.unauthorized);
    }
  });

  it('allows the extension ask, interrupt and pets.list, and nothing else', () => {
    expect([...EXTENSION_METHODS].sort()).toEqual(['ask', 'interrupt', 'pets.list']);
  });

  it('keeps every method for the desktop', async () => {
    const s = await start({ handlers: { 'settings.get': () => ({}) as never } });
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    const res = await client.call('settings.get', {});
    expect(res['error']).toBeUndefined();
  });

  it('closes a connection that never says hello', async () => {
    const s = await start({ helloTimeoutMs: 50 });
    const client = await TestClient.connect(s.port);
    await client.closed();
    expect(s.sessions()).toHaveLength(0);
  });

  it('closes a connection that sends a large message before hello', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    client.send({ jsonrpc: '2.0', id: 1, method: 'hello', params: { pad: 'x'.repeat(70_000) } });
    await client.closed();
  });
});

describe('rpc routing', () => {
  it('routes a call to its handler and returns the result', async () => {
    const turnId = '11111111-2222-4333-8444-555555555555';
    const s = await start({
      handlers: { ask: () => ({ turnId }) },
    });
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());

    const res = await client.call('ask', { petId: 'scout', input: { text: 'explain this' } });

    expect((res['result'] as Record<string, unknown>)['turnId']).toBe(turnId);
  });

  it('answers an unknown method with methodNotFound', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());

    const res = await client.call('telepathy', {});

    expect((res['error'] as Record<string, unknown>)['code']).toBe(RPC_ERROR_CODES.methodNotFound);
  });

  it('answers bad params with invalidParams before the handler runs', async () => {
    let called = false;
    const s = await start({
      handlers: {
        ask: () => {
          called = true;
          return { turnId: '11111111-2222-4333-8444-555555555555' };
        },
      },
    });
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());

    const res = await client.call('ask', { petId: 'scout', input: {} });

    expect((res['error'] as Record<string, unknown>)['code']).toBe(RPC_ERROR_CODES.invalidParams);
    expect(called).toBe(false);
  });

  it('turns a handler failure into internalError rather than dropping the call', async () => {
    const s = await start({
      handlers: {
        'pets.list': () => {
          throw new Error('database on fire');
        },
      },
    });
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());

    const res = await client.call('pets.list', {});
    const error = res['error'] as Record<string, unknown>;

    expect(error['code']).toBe(RPC_ERROR_CODES.internalError);
    expect(String(error['message'])).toContain('database on fire');
  });

  it('answers a handler that refuses with an RpcFailure with that failure’s own code', async () => {
    const s = await start({
      handlers: {
        'pets.list': () => {
          throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'no role "wizard"');
        },
      },
    });
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());

    const res = await client.call('pets.list', {});

    expect(res['error']).toEqual({
      code: RPC_ERROR_CODES.invalidParams,
      message: 'no role "wizard"',
    });
  });

  it('answers malformed JSON with parseError', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());

    const res = await client.sendRaw('{not json');

    expect((res['error'] as Record<string, unknown>)['code']).toBe(RPC_ERROR_CODES.parseError);
  });
});

describe('notifications', () => {
  it('delivers a turn notification to the connected host', async () => {
    const turnId = '11111111-2222-4333-8444-555555555555';
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());

    s.broadcast('turn.delta', { turnId, text: 'streaming' });
    await vi.waitFor(() => expect(client.notifications).toHaveLength(1));

    expect(client.notifications[0]?.method).toBe('turn.delta');
    expect(client.notifications[0]?.params).toEqual({ turnId, text: 'streaming' });
  });
});

describe('perception.capture', () => {
  it('asks the host to capture and resolves with the snapshot patch', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    client.onRequest = () => ({ snapshot: { selection: 'the highlighted text' } });

    const session = s.sessions()[0] as HostSession;
    const patch = await session.capture(['selection']);

    expect(patch.selection).toBe('the highlighted text');
  });
});

describe('perception.readText', () => {
  it('asks the host for one window and resolves with what it read', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    client.onRequest = () => ({
      windowId: 'w-1',
      text: 'error TS2532',
      truncated: false,
      source: 'uia',
    });

    const session = s.sessions()[0] as HostSession;
    const reading = await session.readText({ windowId: 'w-1', maxChars: 8_000 });

    expect(reading.text).toBe('error TS2532');
    expect(reading.windowId).toBe('w-1');
  });

  it('carries the notes that qualify a thin read', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    client.onRequest = () => ({
      windowId: 'w-1',
      text: '',
      truncated: false,
      source: 'uia',
      notes: ['Code published no text through the accessibility tree.'],
    });

    const session = s.sessions()[0] as HostSession;
    const reading = await session.readText({ maxChars: 8_000 });

    expect(reading.notes?.[0]).toMatch(/no text/);
  });

  it('carries a refusal for an excluded window', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    client.onRequest = () => ({
      windowId: 'w-1',
      text: '',
      truncated: false,
      source: 'uia',
      blocked: { rule: 'processName', entry: '1Password.exe' },
    });

    const session = s.sessions()[0] as HostSession;
    const reading = await session.readText({ windowId: 'w-1', maxChars: 8_000 });

    expect(reading.blocked?.entry).toBe('1Password.exe');
    expect(reading.text).toBe('');
  });
});

describe('perception.captureWindow', () => {
  it('asks the host for one window and validates the picture it sends back', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    const asked: Array<{ method: string; params: unknown }> = [];
    client.onRequest = (method, params) => {
      asked.push({ method, params });
      return {
        windowId: 'w-1',
        image: { mime: 'image/png', base64: 'cG5n', width: 10, height: 10 },
      };
    };

    const session = s.sessions()[0] as HostSession;
    const shot = await session.captureWindow({ windowId: 'w-1', maxLongSide: 1568 });

    expect(asked).toEqual([
      { method: 'perception.captureWindow', params: { windowId: 'w-1', maxLongSide: 1568 } },
    ]);
    expect(shot.image?.width).toBe(10);
  });
});

describe('screen.pointAt', () => {
  it('asks the host to point and validates its answer', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    const asked: Array<{ method: string; params: unknown }> = [];
    client.onRequest = (method, params) => {
      asked.push({ method, params });
      return { shown: true, screen: 2 };
    };

    const session = s.sessions()[0] as HostSession;
    const answer = await session.pointAt({ windowId: 'w-1', name: 'Export', label: 'Export' });

    expect(asked).toEqual([
      { method: 'screen.pointAt', params: { windowId: 'w-1', name: 'Export', label: 'Export' } },
    ]);
    expect(answer).toEqual({ shown: true, screen: 2 });
  });

  it('rejects an answer that is not a pointing result', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    client.onRequest = () => ({ shown: 'yes' });

    const session = s.sessions()[0] as HostSession;
    await expect(session.pointAt({ windowId: 'w-1', name: 'Export' })).rejects.toThrow();
  });
});

describe('perception.recall and perception.diff', () => {
  it('asks the host for a remembered moment and validates the answer', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    const asked: Array<{ method: string; params: unknown }> = [];
    client.onRequest = (method, params) => {
      asked.push({ method, params });
      return { recording: false, frames: [], windows: [] };
    };

    const session = s.sessions()[0] as HostSession;
    const result = await session.recall({ secondsAgo: 300 });

    expect(asked).toEqual([{ method: 'perception.recall', params: { secondsAgo: 300 } }]);
    expect(result.recording).toBe(false);
  });

  it('asks the host for a diff, defaulting to images', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    const asked: Array<{ method: string; params: unknown }> = [];
    client.onRequest = (method, params) => {
      asked.push({ method, params });
      return { changeRatio: 0.2, afterAt: '2026-10-04T10:00:00.000Z' };
    };

    const session = s.sessions()[0] as HostSession;
    const result = await session.diff({ displayId: 1, sinceSeconds: 5 });

    expect(asked[0]).toEqual({
      method: 'perception.diff',
      params: { displayId: 1, sinceSeconds: 5, includeImages: true },
    });
    expect(result.changeRatio).toBe(0.2);
  });

  it('refuses a malformed diff rather than handing it to a pet', async () => {
    const s = await start();
    const client = await TestClient.connect(s.port);
    await client.call('hello', hello());
    client.onRequest = () => ({ changeRatio: 7 });

    const session = s.sessions()[0] as HostSession;
    await expect(session.diff({ displayId: 1, sinceSeconds: 5 })).rejects.toThrow();
  });
});
