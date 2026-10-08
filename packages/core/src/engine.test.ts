import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, RPC_ERROR_CODES } from '@tagalong/protocol';
import { listRoles, recommendedModel, roleFor } from './roles';
import { Engine } from './engine';
import { openDatabase } from './memory/db';
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

describe('activity over rpc', () => {
  it('lists each turn, the handoff and the roundtable, newest first, and pages', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const completedCount = () => host.methods().filter((m) => m === 'turn.completed').length;

    await host.call('ask', { petId: 'scout', input: { text: 'Explain the release notes' } });
    await vi.waitFor(() => expect(completedCount()).toBe(1), { timeout: 5000 });
    await host.call('ask', { petId: 'scout', input: { text: '@Ink draft a reply' } });
    await vi.waitFor(() => expect(completedCount()).toBe(2), { timeout: 5000 });
    await host.call('ask', { petId: 'ink', input: { text: '/crew Dock left?' } });
    await vi.waitFor(
      () =>
        expect(
          host.notifications.some(
            (n) => n.method === 'crew.status' && n.params['state'] === 'done',
          ),
        ).toBe(true),
      { timeout: 10000 },
    );

    const res = await host.call('activity.list', {});
    const entries = (res['result'] as { entries: Record<string, unknown>[] }).entries;
    const kinds = entries.map((entry) => entry['kind']);
    // Newest first: the roundtable's four turns and the run itself, then the handoff, then
    // the turns before it.
    expect(kinds.at(-1)).toBe('turn');
    expect(entries.at(-1)).toMatchObject({
      petId: 'scout',
      state: 'done',
      text: 'Explain the release notes',
      model: expect.any(String) as string,
    });
    expect(entries.find((entry) => entry['kind'] === 'handoff')).toMatchObject({
      petId: 'scout',
      toPetId: 'ink',
      state: 'done',
    });
    expect(entries.find((entry) => entry['kind'] === 'roundtable')).toMatchObject({
      petId: 'ink',
      state: 'done',
      modelCalls: 4,
    });

    const page = await host.call('activity.list', { limit: 2 });
    const first = page['result'] as { entries: unknown[]; next?: string };
    expect(first.entries).toHaveLength(2);
    expect(first.next).toBeDefined();
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
      notes: 'You are Pip.',
      model: 'fake-model',
      providerId: 'fake',
      color: '#22c55e',
      roleId: 'generalist',
      roleVersion: 1,
      toolGrants: {},
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

describe('roles over rpc', () => {
  async function connected(): Promise<{ e: Engine; host: TestHost }> {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    return { e, host };
  }

  const draft = (overrides: Record<string, unknown> = {}) => ({
    id: 'pip',
    name: 'Pip',
    avatar: '🐣',
    model: 'fake-model',
    providerId: 'fake',
    roleId: 'writer',
    roleVersion: 99,
    toolGrants: {},
    replyStyle: 'text',
    ...overrides,
  });

  it('lists the whole role library', async () => {
    const { host } = await connected();
    const res = await host.call('roles.list', {});
    expect(res['result']).toEqual({ roles: listRoles() });
  });

  it('recommends the role’s model, and a vision model when the role needs to see', async () => {
    const { host } = await connected();
    for (const roleId of ['writer', 'frontend-engineer']) {
      const res = await host.call('roles.recommendModel', { roleId, providerId: 'nebius' });
      expect(res['result']).toEqual(recommendedModel(roleFor(roleId), 'nebius'));
    }
    const sees = await host.call('roles.recommendModel', {
      roleId: 'frontend-engineer',
      providerId: 'nebius',
    });
    expect((sees['result'] as Record<string, unknown>)['visionModel']).toBeDefined();
  });

  it('recommends nothing on a provider without a tier table', async () => {
    const { host } = await connected();
    const res = await host.call('roles.recommendModel', { roleId: 'writer', providerId: 'fake' });
    expect(res['result']).toEqual({});
  });

  it('refuses to recommend for a role that does not exist', async () => {
    const { host } = await connected();
    const res = await host.call('roles.recommendModel', {
      roleId: 'wizard',
      providerId: 'nebius',
    });
    const error = res['error'] as Record<string, unknown>;
    expect(error['code']).toBe(RPC_ERROR_CODES.invalidParams);
    expect(String(error['message'])).toContain('wizard');
  });

  it('refuses a pet whose role is not in the library, and saves nothing', async () => {
    const { e, host } = await connected();
    const res = await host.call('pets.upsert', { pet: draft({ roleId: 'wizard' }) });
    const error = res['error'] as Record<string, unknown>;
    expect(error['code']).toBe(RPC_ERROR_CODES.invalidParams);
    expect(String(error['message'])).toContain('wizard');
    expect(e.pets.map((pet) => pet.id)).not.toContain('pip');
  });

  it('stamps a new pet with its role’s library version', async () => {
    const { host } = await connected();
    const res = await host.call('pets.upsert', { pet: draft() });
    const pet = (res['result'] as { pet: Record<string, unknown> }).pet;
    expect(pet['roleVersion']).toBe(roleFor('writer').version);
  });

  it('keeps an existing pet’s role version, and restamps it when the role changes', async () => {
    const { host } = await connected();
    await host.call('pets.upsert', { pet: draft() });

    const kept = await host.call('pets.upsert', { pet: draft({ name: 'Pippa', roleVersion: 7 }) });
    expect((kept['result'] as { pet: Record<string, unknown> }).pet['roleVersion']).toBe(7);

    const moved = await host.call('pets.upsert', {
      pet: draft({ roleId: 'researcher', roleVersion: 7 }),
    });
    expect((moved['result'] as { pet: Record<string, unknown> }).pet['roleVersion']).toBe(
      roleFor('researcher').version,
    );
  });
});

describe('the roles notice over rpc', () => {
  /** Leaves `dir` holding a database from before roles, with Ink's persona edited. */
  function storePreRolesInstall(): void {
    const db = openDatabase(dir);
    db.prepare('DELETE FROM schema_version WHERE version >= 5').run();
    db.exec('DROP TABLE notices');
    const legacy = {
      id: 'ink',
      name: 'Ink',
      avatar: '✒️',
      model: 'fake-model',
      providerId: 'fake',
      persona: 'Write like a pirate.',
      toolAllowlist: [],
      replyStyle: 'text',
    };
    db.prepare('INSERT INTO pets (id, json, updated_at) VALUES (?, ?, ?)').run(
      'ink',
      JSON.stringify(legacy),
      '2026-09-11T00:00:00.000Z',
    );
    db.prepare('INSERT INTO pet_seeds (id, seeded_at) VALUES (?, ?)').run('ink', '2026-09-11');
    db.close();
  }

  async function connected(): Promise<TestHost> {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    return host;
  }

  it('has no notice on a fresh install', async () => {
    const host = await connected();
    const res = await host.call('notices.rolesUpgrade', {});
    expect(res['result']).toEqual({ notice: null });
  });

  it('tells an upgraded install what the upgrade did, until it is dismissed', async () => {
    storePreRolesInstall();
    const host = await connected();

    const res = await host.call('notices.rolesUpgrade', {});
    expect(res['result']).toEqual({
      notice: {
        pets: [{ petId: 'ink', name: 'Ink', roleId: 'writer', keptNotes: true, madeByYou: false }],
      },
    });

    const dismissed = await host.call('notices.dismiss', { notice: 'rolesUpgrade' });
    expect(dismissed['result']).toEqual({ dismissed: true });
    const after = await host.call('notices.rolesUpgrade', {});
    expect(after['result']).toEqual({ notice: null });
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

describe('watch mode over rpc', () => {
  it('starts a watch from watch_for, announces it, and stops it on watch.stop', async () => {
    const e = await boot(
      new FakeBrainProvider({
        text: 'I will tell you.',
        toolCall: {
          id: 'call-w',
          name: 'watch_for',
          input: { condition: 'the build finishes', displayId: 1 },
        },
      }),
    );
    const host = await TestHost.connect(e.port);
    const asked: string[] = [];
    host.onRequest = (method) => {
      asked.push(method);
      return { changeRatio: 0, afterAt: new Date().toISOString() };
    };
    await host.call('hello', {
      ...helloParams(e.pairingToken),
      capabilities: ['activeWindow', 'displays', 'recall'] as const,
    });

    await host.call('ask', { petId: 'scout', input: { text: 'tell me when it finishes' } });
    await vi.waitFor(() => expect(host.methods()).toContain('watch.status'), { timeout: 5000 });

    expect(asked).toContain('perception.diff');
    const status = host.notifications.find((n) => n.method === 'watch.status')!;
    expect(status.params).toMatchObject({
      petId: 'scout',
      condition: 'the build finishes',
      state: 'watching',
      maxChecks: 60,
    });

    const stop = await host.call('watch.stop', { watchId: status.params['watchId'] });
    expect(stop['result']).toEqual({ stopped: true });
    await vi.waitFor(() =>
      expect(host.notifications.map((n) => n.params['state'])).toContain('stopped'),
    );
    const again = await host.call('watch.stop', { watchId: status.params['watchId'] });
    expect(again['result']).toEqual({ stopped: false });
  });
});

describe('watch limits without a restart', () => {
  it('applies a limit saved through settings.set to the next watch', async () => {
    const e = await boot(
      new FakeBrainProvider({
        text: 'Watching.',
        toolCall: { id: 'call-l', name: 'watch_for', input: { condition: 'done', displayId: 1 } },
      }),
    );
    const host = await TestHost.connect(e.port);
    host.onRequest = () => ({ changeRatio: 0, afterAt: new Date().toISOString() });
    await host.call('hello', {
      ...helloParams(e.pairingToken),
      capabilities: ['displays', 'recall'] as const,
    });

    await host.call('settings.set', {
      patch: { watch: { maxChecks: 7, maxConcurrent: 1, defaultTimeoutMinutes: 5 } },
    });
    await host.call('ask', { petId: 'scout', input: { text: 'tell me when it is done' } });
    await vi.waitFor(() => expect(host.methods()).toContain('watch.status'), { timeout: 5000 });

    const status = host.notifications.find((n) => n.method === 'watch.status')!;
    expect(status.params['maxChecks']).toBe(7);
  });
});
