import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@tagalong/protocol';
import { Engine } from './engine';
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

async function boot(): Promise<Engine> {
  engine = await Engine.boot({
    dataDir: dir,
    secretStore: new InMemorySecretStore(),
    engineVersion: '0.0.0-test',
    // Port 0 lets the OS pick, so a real engine on 47321 never collides with a test.
    port: 0,
    env: { TAGALONG_FAKE_PROVIDERS: '1' },
  });
  return engine;
}

/** Minimal host: speaks the real wire format so the test exercises the real server. */
class TestHost {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<number, (msg: Record<string, unknown>) => void>();
  readonly notifications: { method: string; params: Record<string, unknown> }[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
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
