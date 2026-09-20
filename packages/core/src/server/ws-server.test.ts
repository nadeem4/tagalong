import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, RPC_ERROR_CODES } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import { EngineServer } from './ws-server';
import type { EngineServerOptions, HostSession } from './ws-server';

const TOKEN = 'a'.repeat(64);

const SCOUT: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  persona: '',
  model: 'claude-sonnet-5',
  providerId: 'anthropic',
  toolAllowlist: [],
  replyStyle: 'text',
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
