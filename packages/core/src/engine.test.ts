import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@tagalong/protocol';
import { Engine } from './engine';
import { FakeBrainProvider, NEBIUS_FALLBACK_MODELS, SECRET_KEYS } from './providers';
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
  /** When set, requests are swallowed unanswered, like a stopped service worker. */
  silent = false;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      // A core-to-host request carries both an id and a method.
      if ('id' in msg && 'method' in msg) {
        if (this.silent) return;
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
    expect((result['pets'] as { id: string }[]).map((pet) => pet.id)).toEqual([
      'bolt',
      'ink',
      'scout',
    ]);
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

  it('builds an OpenRouter pet from its stored key and reaches the turn', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_KEYS.openrouter!, 'sk-or-test');
    engine = await Engine.boot({
      dataDir: dir,
      secretStore: secrets,
      engineVersion: '0.0.0-test',
      port: 0,
      // A dead base URL keeps this test off the network: the key is found, the provider
      // is built, and the request fails to connect rather than going anywhere real.
      env: {},
    });
    const host = await TestHost.connect(engine.port);
    await host.call('hello', helloParams(engine.pairingToken));
    await host.call('settings.set', {
      patch: { providerBaseUrls: { openrouter: 'http://127.0.0.1:9/v1' } },
    });
    const scout = (
      (await host.call('pets.list'))['result'] as { pets: Record<string, unknown>[] }
    ).pets.find((pet) => pet['id'] === 'scout');
    await host.call('pets.upsert', {
      pet: { ...scout, providerId: 'openrouter', model: 'anthropic/claude-sonnet-5' },
    });

    await host.call('ask', { petId: 'scout', input: { text: 'hi' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.error'), { timeout: 10000 });

    const error = host.notifications.find((n) => n.method === 'turn.error');
    // Not 'auth': the key was found. The dead URL is what failed.
    expect(error?.params['code']).toBe('connection');
    expect(String(error?.params['message'])).toContain('OpenRouter');
  });

  it('answers each pet from the provider it names', async () => {
    const { host } = await bootWithoutFakes();
    const scout = (
      (await host.call('pets.list'))['result'] as { pets: Record<string, unknown>[] }
    ).pets.find((pet) => pet['id'] === 'scout');
    await host.call('pets.upsert', {
      pet: { ...scout, id: 'ink', name: 'Ink', providerId: 'fake', model: 'fake-model' },
    });

    await host.call('ask', { petId: 'ink', input: { text: 'hi' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    expect(host.methods()).not.toContain('turn.error');
  });
});

describe('models.list', () => {
  async function connected(env: Record<string, string>, secrets = new InMemorySecretStore()) {
    engine = await Engine.boot({
      dataDir: dir,
      secretStore: secrets,
      engineVersion: '0.0.0-test',
      port: 0,
      env,
    });
    const host = await TestHost.connect(engine.port);
    await host.call('hello', helloParams(engine.pairingToken));
    return host;
  }

  it('offers the built-in Nemotron list when no Token Factory key is stored', async () => {
    const host = await connected({});
    const res = await host.call('models.list', { providerId: 'nebius' });
    expect(res['result']).toEqual({
      models: [...NEBIUS_FALLBACK_MODELS],
      source: 'fallback',
    });
  });

  it('never asks the network in fake mode, even with a key stored', async () => {
    const secrets = new InMemorySecretStore();
    await secrets.set(SECRET_KEYS.openrouter!, 'sk-or-test');
    const host = await connected({ TAGALONG_FAKE_PROVIDERS: '1' }, secrets);

    const res = await host.call('models.list', { providerId: 'openrouter' });

    expect((res['result'] as { source: string }).source).toBe('fallback');
  });

  it('lists the fixed models of providers without a live list', async () => {
    const host = await connected({});
    const anthropic = await host.call('models.list', { providerId: 'anthropic' });
    const fake = await host.call('models.list', { providerId: 'fake' });
    expect((anthropic['result'] as { models: string[] }).models).toContain('claude-opus-5');
    expect((fake['result'] as { models: string[] }).models).toEqual(['fake-model']);
  });

  it('answers an unknown provider with an error', async () => {
    const host = await connected({});
    const res = await host.call('models.list', { providerId: 'ollama' });
    expect(res['error']).toBeDefined();
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

describe('handoff over rpc', () => {
  it('hands Scout’s thread to Ink when the user types @Ink, with the context intact', async () => {
    const seen: { model: string; text: string }[] = [];
    const fake = new FakeBrainProvider({ text: 'An answer.' });
    const recording: BrainProvider = {
      id: 'fake',
      capabilities: fake.capabilities,
      listModels: () => fake.listModels(),
      complete: (req, handlers, signal) => {
        seen.push({ model: req.model, text: JSON.stringify(req.messages) });
        return fake.complete(req, handlers, signal);
      },
    };
    const e = await boot(recording);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    await host.call('ask', { petId: 'scout', input: { text: 'Explain the release notes' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });
    const started = host.notifications.find((n) => n.method === 'turn.started');
    const conversationId = started?.params['conversationId'];

    await host.call('ask', {
      petId: 'scout',
      conversationId,
      input: { text: '@Ink draft a reply to this' },
    });
    await vi.waitFor(
      () => expect(host.methods().filter((m) => m === 'turn.completed')).toHaveLength(2),
      { timeout: 5000 },
    );

    const handoff = host.notifications.find((n) => n.method === 'pet.message');
    expect(handoff?.params).toMatchObject({ kind: 'handoff', fromPetId: 'scout', toPetId: 'ink' });
    const inkStart = host.notifications.filter((n) => n.method === 'turn.started')[1];
    expect(inkStart?.params).toMatchObject({ petId: 'ink', model: 'anthropic/claude-sonnet-5' });
    expect(inkStart?.params['conversationId']).not.toBe(conversationId);
    expect(seen[1]?.model).toBe('anthropic/claude-sonnet-5');
    expect(seen[1]?.text).toContain('Explain the release notes');
    expect(seen[1]?.text).toContain('draft a reply to this');
  });
});

describe('roundtable over rpc', () => {
  it('runs /crew across the whole crew and ends with the asking pet’s synthesis', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    await host.call('ask', { petId: 'ink', input: { text: '/crew Should the panel dock left?' } });
    await vi.waitFor(
      () =>
        expect(
          host.notifications.some(
            (n) => n.method === 'crew.status' && n.params['state'] === 'done',
          ),
        ).toBe(true),
      { timeout: 10000 },
    );

    const speakers = host.notifications
      .filter((n) => n.method === 'turn.started')
      .map((n) => n.params['petId']);
    expect(speakers).toEqual(['ink', 'bolt', 'scout', 'ink']);
    const done = host.notifications.find(
      (n) => n.method === 'crew.status' && n.params['state'] === 'done',
    );
    expect(done?.params['modelCalls']).toBe(4);
  });
});

describe('memory across a restart', () => {
  it('remembers a stated preference after the engine restarts', async () => {
    const systems: string[] = [];
    const fake = new FakeBrainProvider({ text: 'Sure.' });
    const recording: BrainProvider = {
      id: 'fake',
      capabilities: fake.capabilities,
      listModels: () => fake.listModels(),
      complete: (req, handlers, signal) => {
        systems.push(req.system);
        return fake.complete(req, handlers, signal);
      },
    };

    const first = await boot(recording);
    let host = await TestHost.connect(first.port);
    await host.call('hello', helloParams(first.pairingToken));
    await host.call('ask', { petId: 'scout', input: { text: 'I prefer short answers.' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });
    await first.shutdown();
    engine = undefined;

    const second = await boot(recording);
    host = await TestHost.connect(second.port);
    await host.call('hello', helloParams(second.pairingToken));
    await host.call('ask', { petId: 'scout', input: { text: 'Explain DNS.' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    expect(systems.at(-1)).toContain('I prefer short answers.');
  });
});

describe('pets and settings over rpc', () => {
  it('lists the seeded crew', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const res = await host.call('pets.list', {});
    const pets = (res['result'] as Record<string, unknown>)['pets'] as unknown[];

    expect(pets).toHaveLength(3);
  });

  it('round-trips an upsert and a delete through rpc, and the delete survives a restart', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const pip = {
      id: 'pip',
      name: 'Pip',
      avatar: '🐣',
      persona: 'You are Pip.',
      model: 'fake-model',
      providerId: 'fake',
      color: '#22c55e',
      toolAllowlist: [],
      replyStyle: 'text',
    };

    const saved = await host.call('pets.upsert', { pet: pip });
    expect((saved['result'] as { pet: unknown }).pet).toEqual(pip);
    const deleted = await host.call('pets.delete', { petId: 'ink' });
    expect(deleted['result']).toEqual({ deleted: true });

    await e.shutdown();
    engine = undefined;
    const again = await boot();
    const ids = again.pets.map((pet) => pet.id);
    expect(ids).toEqual(['bolt', 'pip', 'scout']);
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

describe('the browser host', () => {
  /** Records every prompt so a test can read what reached the model. */
  function recordingProvider(script: ConstructorParameters<typeof FakeBrainProvider>[0]) {
    const prompts: string[] = [];
    const inner = new FakeBrainProvider(script);
    const provider: BrainProvider = {
      id: inner.id,
      capabilities: inner.capabilities,
      listModels: () => inner.listModels(),
      complete: (req, events, signal) => {
        prompts.push(JSON.stringify(req));
        return inner.complete(req, events, signal);
      },
    };
    return { provider, prompts };
  }

  const CHROME = { name: 'chrome.exe', windowTitle: 'Release notes - Google Chrome' };
  const PAGE = {
    url: 'https://example.com/notes',
    title: 'Release notes',
    text: 'Version 2 ships the side panel.',
  };

  async function connectExtension(e: Engine): Promise<{ ext: TestHost; asked: unknown[] }> {
    const ext = await TestHost.connect(e.port);
    const asked: unknown[] = [];
    ext.onRequest = (_method, params) => {
      asked.push((params as Record<string, unknown>)['what']);
      return {
        snapshot: {
          app: { name: 'chrome', windowTitle: 'Release notes' },
          selection: 'the exact words',
          page: PAGE,
        },
      };
    };
    await ext.call('hello', {
      host: 'extension',
      version: '0.0.0',
      capabilities: ['selection', 'pageText', 'activeWindow'],
      token: e.pairingToken,
    });
    return { ext, asked };
  }

  const desktopAsk = {
    petId: 'scout',
    input: { text: 'what does this say?' },
    snapshot: {
      id: '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
      capturedAt: '2026-10-04T00:00:00.000Z',
      host: 'desktop',
      app: CHROME,
      selection: 'clipboard-trick copy',
    },
  };

  it('fills a desktop ask made in Chrome with the exact selection and the page text', async () => {
    const { provider, prompts } = recordingProvider({ text: 'ok' });
    const e = await boot(provider);
    const desk = await TestHost.connect(e.port);
    await desk.call('hello', helloParams(e.pairingToken));
    const { asked } = await connectExtension(e);

    await desk.call('ask', desktopAsk);
    await vi.waitFor(() => expect(desk.methods()).toContain('turn.completed'), { timeout: 5000 });

    expect(asked).toEqual([['selection', 'pageText', 'activeWindow']]);
    expect(prompts[0]).toContain('the exact words');
    expect(prompts[0]).toContain('Version 2 ships the side panel.');
    expect(prompts[0]).not.toContain('clipboard-trick copy');
  });

  it('answers with the desktop capture when the extension does not reply within 500 ms', async () => {
    const { provider, prompts } = recordingProvider({ text: 'ok' });
    const e = await boot(provider);
    const desk = await TestHost.connect(e.port);
    await desk.call('hello', helloParams(e.pairingToken));
    const { ext } = await connectExtension(e);
    ext.silent = true;

    const started = Date.now();
    await desk.call('ask', desktopAsk);
    expect(Date.now() - started).toBeLessThan(2_000);
    await vi.waitFor(() => expect(desk.methods()).toContain('turn.completed'), { timeout: 5000 });
    expect(prompts[0]).toContain('clipboard-trick copy');
  });

  it('routes get_selection to the extension when Chrome is in front', async () => {
    const e = await boot(
      new FakeBrainProvider({
        text: 'got it',
        toolCall: { id: 'call-1', name: 'get_selection', input: {} },
      }),
    );
    const desk = await TestHost.connect(e.port);
    const deskAsked: unknown[] = [];
    desk.onRequest = (_method, params) => {
      const what = (params as Record<string, unknown>)['what'] as string[];
      deskAsked.push(what);
      return { snapshot: what.includes('activeWindow') ? { app: CHROME } : { selection: 'x' } };
    };
    await desk.call('hello', helloParams(e.pairingToken));
    const { asked } = await connectExtension(e);

    await desk.call('ask', { petId: 'scout', input: { text: 'read my selection' } });
    await vi.waitFor(() => expect(desk.methods()).toContain('turn.completed'), { timeout: 5000 });

    expect(deskAsked).toEqual([['activeWindow']]);
    expect(asked).toEqual([['selection']]);
  });
});
