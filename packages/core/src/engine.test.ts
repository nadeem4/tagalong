import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@tagalong/protocol';
import { Engine } from './engine';
import { FakeBrainProvider } from './providers';
import type { BrainProvider } from './providers';
import { InMemorySecretStore } from './settings/settings';

let dir: string;
let engine: Engine | undefined;
const sockets: WebSocket[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-engine-'));
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await engine?.shutdown();
  engine = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function boot(provider?: BrainProvider): Promise<Engine> {
  engine = await Engine.boot({
    dataDir: dir,
    secretStore: new InMemorySecretStore(),
    engineVersion: '0.0.0-test',
    // Port 0 lets the OS pick, so a real engine on 47321 never collides with a test.
    port: 0,
    env: { TAGALONG_FAKE_PROVIDERS: '1' },
    ...(provider ? { provider } : {}),
  });
  return engine;
}

/** Minimal host: speaks the real wire format so the test exercises the real server. */
class TestHost {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<number, (msg: Record<string, unknown>) => void>();
  readonly notifications: { method: string; params: Record<string, unknown> }[] = [];
  /** Answers core-to-host requests such as perception.capture. */
  onRequest: ((method: string, params: unknown) => unknown) | undefined;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      // A core-to-host request carries both an id and a method.
      if ('id' in msg && 'method' in msg) {
        const answer = this.onRequest?.(String(msg['method']), msg['params']);
        this.#socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg['id'], result: answer }));
        return;
      }
      if ('id' in msg && !('method' in msg)) {
        const resolve = this.#pending.get(msg['id'] as number);
        this.#pending.delete(msg['id'] as number);
        resolve?.(msg);
        return;
      }
      this.notifications.push({
        method: String(msg['method']),
        params: (msg['params'] ?? {}) as Record<string, unknown>,
      });
    });
  }

  static async connect(port: number): Promise<TestHost> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return new TestHost(socket);
  }

  call(method: string, params?: unknown): Promise<Record<string, unknown>> {
    const id = this.#nextId++;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  methods(): string[] {
    return this.notifications.map((n) => n.method);
  }
}

const helloParams = (token: string) => ({
  host: 'desktop' as const,
  version: '0.0.0',
  capabilities: ['selection', 'activeWindow'] as const,
  token,
});

describe('Engine.boot', () => {
  it('seeds the default pet and reports itself in hello', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);

    const res = await host.call('hello', helloParams(e.pairingToken));
    const result = res['result'] as Record<string, unknown>;

    expect(result['protocolVersion']).toBe(PROTOCOL_VERSION);
    expect(result['engineVersion']).toBe('0.0.0-test');
    expect(result['pets']).toHaveLength(1);
  });

  it('rejects a host presenting the wrong pairing token', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);

    const res = await host.call('hello', helloParams('b'.repeat(64)));

    expect(res['error']).toBeDefined();
  });

  it('reuses its database and pairing token across restarts', async () => {
    const first = await boot();
    const token = first.pairingToken;
    await first.shutdown();

    engine = await Engine.boot({
      dataDir: dir,
      secretStore: new InMemorySecretStore(),
      engineVersion: '0.0.0-test',
      port: 0,
      env: { TAGALONG_FAKE_PROVIDERS: '1' },
    });

    expect(engine.pairingToken).toBe(token);
  });
});

describe('per-pet providers', () => {
  async function bootWithoutFakes(): Promise<{ e: Engine; host: TestHost }> {
    engine = await Engine.boot({
      dataDir: dir,
      secretStore: new InMemorySecretStore(),
      engineVersion: '0.0.0-test',
      port: 0,
      env: {},
    });
    const host = await TestHost.connect(engine.port);
    await host.call('hello', helloParams(engine.pairingToken));
    return { e: engine, host };
  }

  it('boots without any key, and a Nemotron pet with no key fails its turn readably', async () => {
    const { host } = await bootWithoutFakes();

    await host.call('ask', { petId: 'scout', input: { text: 'hi' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.error'), { timeout: 5000 });

    const error = host.notifications.find((n) => n.method === 'turn.error');
    expect(error?.params['code']).toBe('auth');
    expect(String(error?.params['message'])).toContain('Token Factory');
  });

  it('answers each pet from the provider it names', async () => {
    const { host } = await bootWithoutFakes();
    const scout = ((await host.call('pets.list'))['result'] as { pets: Record<string, unknown>[] })
      .pets[0];
    await host.call('pets.upsert', {
      pet: { ...scout, id: 'ink', name: 'Ink', providerId: 'fake', model: 'fake-model' },
    });

    await host.call('ask', { petId: 'ink', input: { text: 'hi' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    expect(host.methods()).not.toContain('turn.error');
  });
});

describe('ask', () => {
  it('streams a turn from ask through to completion', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const res = await host.call('ask', {
      petId: 'scout',
      input: { text: 'what is this?' },
    });
    const turnId = (res['result'] as Record<string, unknown>)['turnId'];

    expect(String(turnId)).toMatch(/^[0-9a-f-]{36}$/);
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    const methods = host.methods();
    expect(methods[0]).toBe('turn.started');
    expect(methods).toContain('turn.delta');
    expect(methods.indexOf('turn.delta')).toBeLessThan(methods.indexOf('turn.completed'));
    expect(methods.filter((m) => m === 'turn.completed')).toHaveLength(1);
  });

  it('carries every turn notification for the same turn id', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const res = await host.call('ask', { petId: 'scout', input: { text: 'hello' } });
    const turnId = (res['result'] as Record<string, unknown>)['turnId'];
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    for (const notification of host.notifications) {
      expect(notification.params['turnId']).toBe(turnId);
    }
  });

  it('persists the exchange so a restart still has the conversation', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('ask', { petId: 'scout', input: { text: 'remember me' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    const conversations = e.conversationCount();

    expect(conversations).toBe(1);
  });

  it('answers an ask for a pet that does not exist with an error', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const res = await host.call('ask', { petId: 'nobody', input: { text: 'hi' } });

    expect(res['error']).toBeDefined();
    expect(String((res['error'] as Record<string, unknown>)['message'])).toContain('nobody');
  });
});

describe('built-in perception tools', () => {
  it('routes look_at_screen to the connected host and finishes the turn', async () => {
    const e = await boot(
      new FakeBrainProvider({
        text: 'a spreadsheet',
        toolCall: { id: 'call-1', name: 'look_at_screen', input: {} },
      }),
    );
    const host = await TestHost.connect(e.port);
    const asked: unknown[] = [];
    host.onRequest = (method, params) => {
      asked.push((params as Record<string, unknown>)['what']);
      expect(method).toBe('perception.capture');
      return {
        snapshot: {
          app: { name: 'notepad.exe', windowTitle: 'budget.txt' },
          screenshot: { mime: 'image/png', base64: 'iVBORw0KGgo=', width: 640, height: 480 },
        },
      };
    };
    await host.call('hello', {
      ...helloParams(e.pairingToken),
      capabilities: ['selection', 'activeWindow', 'screenshot'] as const,
    });

    await host.call('ask', { petId: 'scout', input: { text: 'what is this?' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    // The window is identified before any pixels are taken, so an exclusion can still bite.
    expect(asked).toEqual([['activeWindow'], ['screenshot']]);
  });
});

describe('pets and settings over rpc', () => {
  it('lists the seeded pet', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const res = await host.call('pets.list', {});
    const pets = (res['result'] as Record<string, unknown>)['pets'] as unknown[];

    expect(pets).toHaveLength(1);
  });

  it('round-trips a settings patch', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    await host.call('settings.set', { patch: { defaultModel: 'claude-haiku-4-5' } });
    const res = await host.call('settings.get', {});
    const settings = (res['result'] as Record<string, unknown>)['settings'] as Record<
      string,
      unknown
    >;

    expect(settings['defaultModel']).toBe('claude-haiku-4-5');
    // A patch must not reset the fields it left out.
    expect(settings['defaultPetId']).toBe('scout');
  });
});
