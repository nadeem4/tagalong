import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, RPC_ERROR_CODES } from '@tagalong/protocol';
import { defaultConnectorFor, Engine, type EngineOptions } from './engine';
import { ClaudeCodeConnector, FakeConnector } from './experts';
import { SPOKEN_HEADING } from './conversation/prompt-assembler';
import { fakeMcpServer } from './connections/fake-server';
import { ActivityLog } from './memory/activity';
import { openDatabase } from './memory/db';
import { ConversationStore } from './memory/store';
import {
  BrainError,
  CLAUDE_CODE_MODELS,
  FakeBrainProvider,
  NEBIUS_FALLBACK_MODELS,
  SECRET_KEYS,
} from './providers';
import type { BrainProvider } from './providers';
import { InMemorySecretStore } from './settings/settings';
import { PickUpStore } from './pick-up/store';

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

async function boot(provider?: BrainProvider, extra: Partial<EngineOptions> = {}): Promise<Engine> {
  engine = await Engine.boot({
    dataDir: dir,
    secretStore: new InMemorySecretStore(),
    engineVersion: '0.0.0-test',
    // Port 0 lets the OS pick, so a real engine on 47321 never collides with a test.
    port: 0,
    env: { TAGALONG_FAKE_PROVIDERS: '1' },
    // The project finder never scans this machine's real code folders in a test.
    projectRoots: () => [],
    ...(provider ? { provider } : {}),
    // Never this machine's own Claude Code servers.
    claudeCodeConfigPath: join(dir, 'no-claude.json'),
    ...extra,
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
    expect((result['pets'] as { id: string }[]).map((pet) => pet.id)).toEqual(['scout']);
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

  it('closes activity a crash left running, so it does not spin forever', async () => {
    const db = openDatabase(dir);
    db.prepare(
      `INSERT INTO activity (id, kind, state, pet_id, started_at)
       VALUES ('left-over', 'expert', 'running', 'scout', '2026-10-12T06:00:00.000Z')`,
    ).run();
    db.close();

    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const res = await host.call('activity.list', {});
    const entries = (res['result'] as { entries: { id: string; state: string }[] }).entries;

    expect(entries.find((entry) => entry.id === 'left-over')?.state).toBe('error');
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
    // Never Scout's own Claude Code sign-in: a test must not start a real claude.
    const listed = await host.call('pets.list', {});
    const [scout] = (listed['result'] as { pets: Record<string, unknown>[] }).pets;
    await host.call('pets.upsert', {
      pet: { ...scout, providerId: 'nebius', model: 'nvidia/nemotron-3-super-120b-a12b' },
    });

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

  it('lists the Claude sign-in models without a key', async () => {
    const host = await connected({});
    const res = await host.call('models.list', { providerId: 'claude-code' });
    expect(res['result']).toEqual({ models: [...CLAUDE_CODE_MODELS], source: 'fallback' });
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

  it('meters the turn: usage.summary shows one Scout row, and the cap is off', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('ask', { petId: 'scout', input: { text: 'what does this cost?' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    const res = await host.call('usage.summary', {});
    const result = res['result'] as {
      today: { source: string; inputTokens: number }[];
      month: unknown[];
      budget: { dailyUsd: number | null; spentOut: boolean };
    };
    expect(result.today).toHaveLength(1);
    expect(result.today[0]?.source).toBe('scout');
    expect(result.today[0]?.inputTokens).toBeGreaterThan(0);
    expect(result.month).toHaveLength(1);
    expect(result.budget).toEqual({ dailyUsd: null, spentOut: false });
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

describe('routines over rpc', () => {
  const PAPERS = {
    name: 'Morning papers',
    when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
    what: 'Find new papers on my topics.',
    topics: 'AI agents',
  };

  it('saves one from Home, lists it with its next run, and runs it now into Scout’s conversation', async () => {
    const e = await boot(
      new FakeBrainProvider({ text: 'Two new papers. The first matters most.' }),
    );
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const saved = (await host.call('routines.save', { routine: PAPERS }))['result'] as {
      routine: { id: string };
    };
    const listed = (await host.call('routines.list', {}))['result'] as {
      routines: { name: string; nextRunAt?: string }[];
    };
    expect(listed.routines[0]?.name).toBe('Morning papers');
    expect(listed.routines[0]?.nextRunAt).toBeDefined();

    const run = await host.call('routines.runNow', { id: saved.routine.id });
    expect(run['result']).toEqual({ started: true });
    await vi.waitFor(() => expect(host.methods()).toContain('routine.result'), { timeout: 5000 });
    const result = host.notifications.find((n) => n.method === 'routine.result')?.params;
    expect(result).toMatchObject({
      name: 'Morning papers',
      state: 'done',
      line: 'Morning papers: Two new papers.',
      text: 'Two new papers. The first matters most.',
    });
    // The turn said which routine started it, so no bubble takes it for a question.
    expect(host.notifications.find((n) => n.method === 'turn.started')?.params).toMatchObject({
      routineId: saved.routine.id,
    });
    const activity = (await host.call('activity.list', {}))['result'] as {
      entries: { kind: string; state: string; conversationId?: string }[];
    };
    const row = activity.entries.find((entry) => entry.kind === 'routine');
    expect(row).toMatchObject({ state: 'done', conversationId: result?.['conversationId'] });
  });

  it('shows Scout’s routine card and saves it only on Save', async () => {
    const e = await boot(
      new FakeBrainProvider({
        text: 'Check the card and press Save.',
        toolCall: {
          id: 'call-1',
          name: 'create_routine',
          input: { ...PAPERS, when: { type: 'weekdays', time: '08:00' } },
        },
      }),
    );
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('ask', { petId: 'scout', input: { text: 'every weekday at 8, new papers' } });
    await vi.waitFor(() => expect(host.methods()).toContain('routine.proposed'), { timeout: 5000 });
    const listedBefore = (await host.call('routines.list', {}))['result'] as { routines: [] };
    expect(listedBefore.routines).toEqual([]);

    const proposal = host.notifications.find((n) => n.method === 'routine.proposed')?.params as {
      proposalId: string;
    };
    const confirmed = (await host.call('routines.confirm', { proposalId: proposal.proposalId }))[
      'result'
    ] as { routine: { name: string; when: unknown } };
    expect(confirmed.routine).toMatchObject({
      name: 'Morning papers',
      when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
    });
    const listed = (await host.call('routines.list', {}))['result'] as { routines: unknown[] };
    expect(listed.routines).toHaveLength(1);
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });
  });
});

describe('keep an eye over rpc', () => {
  it('reads a window whose title reads like trouble, and says one line as pet.remark', async () => {
    const e = await boot(new FakeBrainProvider({ text: 'The build broke on a missing import.' }));
    const host = await TestHost.connect(e.port);
    const reads: unknown[] = [];
    host.onRequest = (method, params) => {
      expect(method).toBe('perception.readText');
      reads.push((params as Record<string, unknown>)['windowId']);
      return { windowId: 'w-7', text: 'error TS2307', truncated: false, source: 'uia' };
    };
    await host.call('hello', {
      ...helloParams(e.pairingToken),
      capabilities: ['textLayer'] as const,
    });

    const window = {
      id: 'w-7',
      processName: 'Code.exe',
      title: 'Build failed',
      state: 'foreground',
      browser: false,
    };
    await host.call('keepAnEye.observe', { windows: [window] });
    await vi.waitFor(() => expect(host.methods()).toContain('pet.remark'), { timeout: 5000 });
    expect(reads).toEqual(['w-7']);
    expect(host.notifications.find((n) => n.method === 'pet.remark')?.params).toMatchObject({
      petId: 'scout',
      text: 'The build broke on a missing import.',
    });

    const quiet = await host.call('keepAnEye.notNow', {});
    const until = Date.parse((quiet['result'] as { quietUntil: string }).quietUntil);
    expect(until - Date.now()).toBeGreaterThan(59 * 60_000);
  });
});

describe('a spoken ask over rpc', () => {
  it('reaches the prompt as spoken mode', async () => {
    const systems: string[] = [];
    const fake = new FakeBrainProvider({ text: 'Sure thing.' });
    const recording: BrainProvider = {
      id: 'fake',
      capabilities: fake.capabilities,
      listModels: () => fake.listModels(),
      complete: (req, handlers, signal) => {
        systems.push(req.system);
        return fake.complete(req, handlers, signal);
      },
    };
    const e = await boot(recording);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    await host.call('ask', { petId: 'scout', input: { text: 'what is this' }, spoken: true });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    expect(systems[0]).toContain(SPOKEN_HEADING);
  });
});

describe('activity over rpc', () => {
  it('lists each turn, newest first, and pages', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const completedCount = () => host.methods().filter((m) => m === 'turn.completed').length;

    await host.call('ask', { petId: 'scout', input: { text: 'Explain the release notes' } });
    await vi.waitFor(() => expect(completedCount()).toBe(1), { timeout: 5000 });
    await host.call('ask', { petId: 'scout', input: { text: 'And the changelog?' } });
    await vi.waitFor(() => expect(completedCount()).toBe(2), { timeout: 5000 });

    const res = await host.call('activity.list', {});
    const entries = (res['result'] as { entries: Record<string, unknown>[] }).entries;
    expect(entries.map((entry) => entry['text'])).toEqual([
      'And the changelog?',
      'Explain the release notes',
    ]);
    expect(entries.at(-1)).toMatchObject({
      kind: 'turn',
      petId: 'scout',
      state: 'done',
      model: expect.any(String) as string,
    });

    const page = await host.call('activity.list', { limit: 1 });
    const first = page['result'] as { entries: unknown[]; next?: string };
    expect(first.entries).toHaveLength(1);
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
  it('lists the seeded companion', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const res = await host.call('pets.list', {});
    const pets = (res['result'] as Record<string, unknown>)['pets'] as unknown[];

    expect(pets).toHaveLength(1);
  });

  it('round-trips an upsert through rpc, and it survives a restart', async () => {
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
      roleId: 'companion',
      toolGrants: {},
      replyStyle: 'text',
    };

    const saved = await host.call('pets.upsert', { pet: pip });
    expect((saved['result'] as { pet: unknown }).pet).toEqual(pip);

    await e.shutdown();
    engine = undefined;
    const again = await boot();
    const ids = again.pets.map((pet) => pet.id);
    expect(ids).toEqual(['pip', 'scout']);
  });

  it('round-trips a settings patch', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    await host.call('settings.set', { patch: { userName: 'Ada' } });
    const res = await host.call('settings.get', {});
    const settings = (res['result'] as Record<string, unknown>)['settings'] as Record<
      string,
      unknown
    >;

    expect(settings['userName']).toBe('Ada');
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
    roleId: 'companion',
    toolGrants: {},
    replyStyle: 'text',
    ...overrides,
  });

  it('refuses a pet whose role is not in the library, and saves nothing', async () => {
    const { e, host } = await connected();
    const res = await host.call('pets.upsert', { pet: draft({ roleId: 'wizard' }) });
    const error = res['error'] as Record<string, unknown>;
    expect(error['code']).toBe(RPC_ERROR_CODES.invalidParams);
    expect(String(error['message'])).toContain('wizard');
    expect(e.pets.map((pet) => pet.id)).not.toContain('pip');
  });

  it('refuses the crew-era methods: they are gone', async () => {
    const { host } = await connected();
    for (const method of ['pets.delete', 'roles.list', 'roles.recommendModel', 'notices.dismiss']) {
      const res = await host.call(method, {});
      expect((res['error'] as Record<string, unknown>)['code']).toBe(
        RPC_ERROR_CODES.methodNotFound,
      );
    }
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

describe('experts and hand-offs', () => {
  const expert = {
    id: 'claude-code',
    name: 'Claude Code',
    goodAt: 'Code',
    connection: { type: 'claude-code', folder: 'C:\\projects\\ai_pet' },
  };

  it('saves an expert, keeps it across a restart, and deletes it', async () => {
    let e = await boot();
    let host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const saved = await host.call('experts.upsert', { expert });
    expect(saved['result']).toMatchObject({ expert: { id: 'claude-code', enabled: true } });

    await e.shutdown();
    e = await boot();
    host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const listed = await host.call('experts.list', {});
    expect((listed['result'] as { experts: unknown[] }).experts).toHaveLength(1);

    expect((await host.call('experts.delete', { expertId: 'claude-code' }))['result']).toEqual({
      deleted: true,
    });
  });

  it('tests an expert without spending anything', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('experts.upsert', { expert });

    expect((await host.call('experts.test', { expertId: 'claude-code' }))['result']).toEqual({
      ok: true,
    });
  });

  it('has no way to start a hand-off without the card: handoffs.start is gone', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('experts.upsert', { expert });
    const res = await host.call('handoffs.start', {
      expertId: 'claude-code',
      petId: 'scout',
      brief: { ask: 'x' },
      folder: process.cwd(),
    });
    expect(res['error']).toMatchObject({ code: RPC_ERROR_CODES.methodNotFound });
    expect(host.methods()).not.toContain('handoff.started');
  });
});

describe('a companion handing work to an expert', () => {
  it('turns a hand_to_expert call into a proposal that runs once confirmed', async () => {
    const provider = new FakeBrainProvider({
      text: 'Claude Code has it.',
      toolCall: {
        id: 'call-1',
        name: 'hand_to_expert',
        input: { ask: 'Why does the build fail?', task_kind: 'fix-code' },
      },
    });
    const e = await boot(provider);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('experts.upsert', {
      expert: {
        id: 'claude-code',
        name: 'Claude Code',
        connection: { type: 'claude-code', folder: 'C:\\projects\\ai_pet' },
      },
    });
    const listed = await host.call('pets.list', {});
    const scout = (listed['result'] as { pets: Record<string, unknown>[] }).pets.find(
      (pet) => pet['id'] === 'scout',
    );
    await host.call('pets.upsert', { pet: { ...scout, roleId: 'companion' } });

    await host.call('ask', { petId: 'scout', input: { text: 'Why does the build fail?' } });
    await vi.waitFor(
      () =>
        expect(host.methods()).toEqual(
          expect.arrayContaining(['handoff.proposed', 'turn.completed']),
        ),
      { timeout: 5000 },
    );
    expect(host.methods()).not.toContain('turn.error');
    // Nothing runs until the person confirms, with the project to work in.
    expect(host.methods()).not.toContain('handoff.finished');
    const proposed = host.notifications.find((n) => n.method === 'handoff.proposed')!;
    // An old expert's default folder is ignored: with no guess, the card opens the picker.
    expect(proposed.params).toMatchObject({ expertName: 'Claude Code', projects: [] });

    const confirmed = await host.call('handoffs.confirm', {
      proposalId: proposed.params['proposalId'],
      folder: 'C:\\projects\\ai_pet',
      canEdit: false,
    });
    expect(confirmed['result']).toMatchObject({ handoffId: expect.any(String) });
    await vi.waitFor(() => expect(host.methods()).toContain('handoff.finished'));

    // The confirmed project is remembered and found by search.
    const found = await host.call('projects.search', { query: 'ai_pet' });
    expect(found['result']).toEqual({
      projects: [{ name: 'ai_pet', path: 'C:\\projects\\ai_pet', reason: 'remembered' }],
    });

    const res = await host.call('activity.list', {});
    const handed = (res['result'] as { entries: Record<string, unknown>[] }).entries.find(
      (entry) => entry['kind'] === 'expert',
    );
    expect(handed).toMatchObject({ petId: 'scout', expertName: 'Claude Code', state: 'done' });
    expect(String(handed?.['text'])).toContain('Why does the build fail?');

    // The brief going to the expert is in the log of what Scout saw, by its size only.
    const seen = await host.call('sightLog.list', {});
    const sent = (seen['result'] as { entries: Record<string, unknown>[] }).entries.find(
      (row) => row['kind'] === 'sent_to_expert',
    );
    expect(sent).toMatchObject({ expertName: 'Claude Code', chars: expect.any(Number) });
    expect(JSON.stringify(sent)).not.toContain('Why does the build fail?');
  });
});

describe('the daily budget over rpc', () => {
  it('once spent, stops keep-an-eye only: an ask, Run now and a confirmed hand-off still go', async () => {
    // A dollar already spent today, against a one-cent cap.
    const db = openDatabase(dir);
    db.prepare(
      `INSERT INTO usage (at, source, provider_id, model, input_tokens, output_tokens, cost_usd)
       VALUES (?, 'scout', 'anthropic', 'claude-opus-5-5', 1000, 1000, 1)`,
    ).run(new Date().toISOString());
    db.close();
    const provider = new FakeBrainProvider({
      text: 'Claude Code has it.',
      toolCall: {
        id: 'call-1',
        name: 'hand_to_expert',
        input: { ask: 'Why does the build fail?', task_kind: 'fix-code' },
      },
    });
    const e = await boot(provider);
    const host = await TestHost.connect(e.port);
    const reads: unknown[] = [];
    host.onRequest = (_method, params) => {
      reads.push(params);
      return { windowId: 'w-7', text: 'error TS2307', truncated: false, source: 'uia' };
    };
    await host.call('hello', {
      ...helloParams(e.pairingToken),
      capabilities: ['textLayer'] as const,
    });
    await host.call('settings.set', { patch: { budget: { dailyUsd: 0.01 } } });
    const summary = (await host.call('usage.summary', {}))['result'] as {
      budget: { dailyUsd: number | null; spentOut: boolean };
    };
    expect(summary.budget).toEqual({ dailyUsd: 0.01, spentOut: true });

    // Keep-an-eye is proactive: nothing is read and nothing is said.
    const window = {
      id: 'w-7',
      processName: 'Code.exe',
      title: 'Build failed',
      state: 'foreground',
      browser: false,
    };
    await host.call('keepAnEye.observe', { windows: [window] });
    expect(reads).toEqual([]);

    // A direct ask still runs, and its confirmed hand-off still finishes.
    await host.call('experts.upsert', {
      expert: {
        id: 'claude-code',
        name: 'Claude Code',
        connection: { type: 'claude-code', folder: 'C:\\projects\\ai_pet' },
      },
    });
    const listed = await host.call('pets.list', {});
    const scout = (listed['result'] as { pets: Record<string, unknown>[] }).pets.find(
      (pet) => pet['id'] === 'scout',
    );
    await host.call('pets.upsert', { pet: { ...scout, roleId: 'companion' } });
    await host.call('ask', { petId: 'scout', input: { text: 'Why does the build fail?' } });
    await vi.waitFor(() => expect(host.methods()).toContain('handoff.proposed'), {
      timeout: 5000,
    });
    expect(host.methods()).not.toContain('turn.error');
    const proposed = host.notifications.find((n) => n.method === 'handoff.proposed')!;
    await host.call('handoffs.confirm', {
      proposalId: proposed.params['proposalId'],
      folder: 'C:\\projects\\ai_pet',
      canEdit: false,
    });
    await vi.waitFor(() => expect(host.methods()).toContain('handoff.finished'), {
      timeout: 5000,
    });

    // Run now is the person's own ask too.
    const saved = (
      await host.call('routines.save', {
        routine: {
          name: 'Morning papers',
          when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
          what: 'Find new papers on my topics.',
        },
      })
    )['result'] as { routine: { id: string } };
    const run = await host.call('routines.runNow', { id: saved.routine.id });
    expect(run['result']).toEqual({ started: true });
    await vi.waitFor(() => expect(host.methods()).toContain('routine.result'), { timeout: 5000 });
  });
});

describe('a mood from a finished hand-off', () => {
  it('cheers when the expert reports the tests pass', async () => {
    const provider = new FakeBrainProvider({
      text: 'Claude Code has it.',
      toolCall: {
        id: 'call-1',
        name: 'hand_to_expert',
        input: { ask: 'Fix the parser test', task_kind: 'fix-code' },
      },
    });
    const e = await boot(provider, {
      connectorFor: () => new FakeConnector({ steps: [], text: 'Fixed it. All tests pass.' }),
    });
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('experts.upsert', {
      expert: { id: 'claude-code', name: 'Claude Code', connection: { type: 'claude-code' } },
    });
    const listed = await host.call('pets.list', {});
    const scout = (listed['result'] as { pets: Record<string, unknown>[] }).pets.find(
      (pet) => pet['id'] === 'scout',
    );
    await host.call('pets.upsert', { pet: { ...scout, roleId: 'companion' } });
    await host.call('ask', { petId: 'scout', input: { text: 'Fix the parser test' } });
    await vi.waitFor(() => expect(host.methods()).toContain('handoff.proposed'), {
      timeout: 5000,
    });
    const proposed = host.notifications.find((n) => n.method === 'handoff.proposed')!;
    await host.call('handoffs.confirm', {
      proposalId: proposed.params['proposalId'],
      folder: 'C:\\projects\\ai_pet',
      canEdit: false,
    });

    await vi.waitFor(() => expect(host.methods()).toContain('pet.mood'));
    expect(host.notifications.find((n) => n.method === 'pet.mood')?.params).toEqual({
      petId: 'scout',
      mood: 'cheer',
    });
  });
});

describe('the built-in blind spots', () => {
  it('hide a key in a question before it reaches the model', async () => {
    const prompts: string[] = [];
    const inner = new FakeBrainProvider({ text: 'ok' });
    const e = await boot({
      id: inner.id,
      capabilities: inner.capabilities,
      listModels: () => inner.listModels(),
      complete: (req, events, signal) => {
        prompts.push(JSON.stringify(req));
        return inner.complete(req, events, signal);
      },
    });
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const key = 'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    await host.call('ask', { petId: 'scout', input: { text: `why is ${key} refused?` } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    expect(prompts.join('')).not.toContain(key);
    expect(prompts.join('')).toContain('[hidden: API key]');
  });
});

describe('greeting.compose', () => {
  it('returns the line the brain wrote for the opening app', async () => {
    const e = await boot(new FakeBrainProvider({ text: 'Morning. Good to see you again.' }));
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const res = await host.call('greeting.compose', { petId: 'scout' });
    expect(res['result']).toEqual({ text: 'Morning. Good to see you again.', source: 'model' });
  });

  it('greets by the name in settings when the brain cannot', async () => {
    const failing: BrainProvider = {
      id: 'fake',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: () => Promise.reject(new Error('offline')),
    };
    const e = await boot(failing);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('settings.set', { patch: { userName: 'Nadeem' } });
    const res = await host.call('greeting.compose', { petId: 'scout' });
    expect((res['result'] as { text: string }).text).toContain(', Nadeem');
  });

  it('counts the time away from when Tagalong was last closed, not last launched', async () => {
    const failing: BrainProvider = {
      id: 'fake',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: () => Promise.reject(new Error('offline')),
    };
    const e = await boot(failing);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    // Opened three days ago and left running until an hour ago: away an hour, not three days.
    await host.call('settings.set', {
      patch: { lastOpenedAt: hoursAgo(72), lastClosedAt: hoursAgo(1) },
    });
    const away = await host.call('greeting.compose', { petId: 'scout' });
    expect((away['result'] as { text: string }).text).not.toContain('Back after');

    // A crash wrote no close: the last launch is the best guess.
    await host.call('settings.set', {
      patch: { lastOpenedAt: hoursAgo(72), lastClosedAt: hoursAgo(100) },
    });
    const crashed = await host.call('greeting.compose', { petId: 'scout' });
    expect((crashed['result'] as { text: string }).text).toContain('Back after 3 days');
  });

  it('refuses a pet that does not exist', async () => {
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const res = await host.call('greeting.compose', { petId: 'nobody' });
    expect(res['error']).toBeDefined();
  });

  it('says it closed unexpectedly when main says the last launch crashed', async () => {
    const failing: BrainProvider = {
      id: 'fake',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: () => Promise.reject(new Error('offline')),
    };
    // A hand-off still running when the last launch died: boot closes it as interrupted.
    const seeded = openDatabase(dir);
    new ActivityLog(seeded, new ConversationStore(seeded)).expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix the test.',
    });
    seeded.close();

    const e = await boot(failing);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const launch = { crashed: true, lastVersion: '0.4.0', version: '0.4.0', whatsNew: '' };
    const res = await host.call('greeting.compose', { petId: 'scout', launch });
    expect((res['result'] as { text: string }).text).toContain(
      'I closed unexpectedly last time, and one task stopped.',
    );
  });

  it('says what is new when the version changed', async () => {
    const failing: BrainProvider = {
      id: 'fake',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: () => Promise.reject(new Error('offline')),
    };
    const e = await boot(failing);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const launch = {
      crashed: false,
      lastVersion: '0.4.0',
      version: '0.5.0',
      whatsNew: 'Setup by voice.',
    };
    const res = await host.call('greeting.compose', { petId: 'scout', launch });
    expect((res['result'] as { text: string }).text).toContain(
      'I’ve been updated to 0.5.0. Setup by voice.',
    );
  });
});

describe('pick up where you left off', () => {
  const launch = { crashed: false, lastVersion: '0.4.0', version: '0.4.0', whatsNew: '' };

  /** A snapshot taken eight hours ago, as a quit last night would leave it. */
  function seedSnapshot(): void {
    const seeded = openDatabase(dir);
    const at = Date.now() - 8 * 3_600_000;
    new PickUpStore(seeded).save({
      startedAt: at - 3_600_000,
      takenAt: at,
      projects: [{ name: 'ai_pet', path: 'C:\\projects\\ai_pet', editor: 'vscode', file: 'a.ts' }],
      handoffs: [
        {
          expertId: 'claude-code',
          expertName: 'Claude Code',
          ask: 'Fix the tests',
          state: 'unsent',
        },
      ],
    });
    seeded.close();
  }

  function counting(): { provider: BrainProvider; calls: () => number } {
    let calls = 0;
    const provider: BrainProvider = {
      id: 'fake',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: () => {
        calls += 1;
        return Promise.resolve({
          text: 'Morning.',
          stopReason: 'end',
          usage: { inputTokens: 1, outputTokens: 1 },
        });
      },
    } as unknown as BrainProvider;
    return { provider, calls: () => calls };
  }

  it('says the pick-up as the launch line, handwritten, with no model call', async () => {
    seedSnapshot();
    const { provider, calls } = counting();
    const e = await boot(provider);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const res = await host.call('greeting.compose', { petId: 'scout', launch });
    const result = res['result'] as {
      text: string;
      source: string;
      pickUp?: { text: string; items: { kind: string; id: string }[] };
    };
    expect(result.source).toBe('fallback');
    expect(result.text).toContain('ai_pet');
    expect(result.pickUp?.text).toBe(result.text);
    expect(result.pickUp?.items.map((item) => item.kind)).toEqual(['project', 'handoff']);
    expect(calls()).toBe(0);

    // Once: the next launch line is an ordinary one.
    const again = await host.call('greeting.compose', { petId: 'scout', launch });
    expect((again['result'] as { pickUp?: unknown }).pickUp).toBeUndefined();
  });

  it('lets an update line win over the pick-up, which then waits', async () => {
    seedSnapshot();
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const updated = { ...launch, version: '0.5.0', whatsNew: 'New things.' };
    const res = await host.call('greeting.compose', { petId: 'scout', launch: updated });
    expect((res['result'] as { pickUp?: unknown }).pickUp).toBeUndefined();
  });

  it('briefs again into the hand-off card, never starting it, and Not now drops it', async () => {
    seedSnapshot();
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('experts.upsert', {
      expert: { id: 'claude-code', name: 'Claude Code', connection: { type: 'claude-code' } },
    });
    const res = await host.call('greeting.compose', { petId: 'scout', launch });
    const items = (res['result'] as { pickUp: { items: { kind: string; id: string }[] } }).pickUp
      .items;
    const handoff = items.find((item) => item.kind === 'handoff');
    const rebrief = await host.call('pickUp.rebrief', { itemId: handoff?.id });
    expect(rebrief['result']).toEqual({ proposed: true });
    await vi.waitFor(() => expect(host.methods()).toContain('handoff.proposed'));
    expect(host.methods()).not.toContain('handoff.finished');
    expect(await host.call('pickUp.dismiss', {})).toMatchObject({ result: { dismissed: true } });
    const after = await host.call('pickUp.rebrief', { itemId: handoff?.id });
    expect(after['result']).toEqual({ proposed: false });
  });

  it('deletes the snapshot when switched off, and offers nothing', async () => {
    seedSnapshot();
    const e = await boot();
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('settings.set', { patch: { pickUp: false } });
    const res = await host.call('greeting.compose', { petId: 'scout', launch });
    expect((res['result'] as { pickUp?: unknown }).pickUp).toBeUndefined();
    await e.shutdown();
    engine = undefined;
    const db = openDatabase(dir);
    expect(new PickUpStore(db).get()).toBeNull();
    db.close();
  });
});

describe('connections over rpc', () => {
  const server = () =>
    fakeMcpServer([
      {
        name: 'search',
        description: 'Search pages.',
        annotations: { readOnlyHint: true },
        run: () => ({ content: [{ type: 'text', text: 'Plan: ship Friday.' }] }),
      },
      {
        name: 'create_page',
        description: 'Create a page.',
        run: () => ({ content: [{ type: 'text', text: 'Created.' }] }),
      },
    ]);

  it('lists Popular and Found on this PC, adds a connection, and disconnects it', async () => {
    const { writeFileSync } = await import('node:fs');
    const claudeJson = join(dir, 'claude.json');
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          wiki: { type: 'http', url: 'https://wiki.example/mcp' },
          tracker: { type: 'http', url: 'https://tracker.example/mcp' },
        },
      }),
    );
    const fake = server();
    const e = await boot(undefined, {
      claudeCodeConfigPath: claudeJson,
      connectorTransport: () => fake.transport(),
    });
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));

    const before = (await host.call('connections.list', {}))['result'] as Record<string, unknown[]>;
    expect((before['popular'] as { id: string }[]).map((p) => p.id)).toEqual([
      'notion',
      'github',
      'linear',
    ]);
    expect((before['found'] as { name: string }[]).map((f) => f.name)).toEqual(['wiki', 'tracker']);

    const added = await host.call('connections.add', {
      name: 'wiki',
      transport: { type: 'http', url: 'https://wiki.example/mcp' },
      auth: 'none',
    });
    const connection = (added['result'] as { connection: Record<string, unknown> }).connection;
    expect(connection['status']).toBe('connected');
    expect(host.methods()).toContain('connections.changed');

    const after = (await host.call('connections.list', {}))['result'] as Record<string, unknown[]>;
    expect((after['found'] as { name: string }[]).map((f) => f.name)).toEqual(['tracker']);

    const again = await host.call('connections.add', {
      id: 'wiki',
      name: 'wiki',
      transport: { type: 'http', url: 'https://wiki.example/mcp' },
      auth: 'none',
    });
    expect((again['error'] as { message: string }).message).toBe('wiki is already connected.');

    await host.call('connections.remove', { id: 'wiki' });
    const gone = (await host.call('connections.list', {}))['result'] as Record<string, unknown[]>;
    expect(gone['connections']).toEqual([]);
  });

  it('Scout reads at once, asks before a change, and logs both to Activity', async () => {
    const fake = server();
    const e = await boot(
      new FakeBrainProvider({
        text: 'Done.',
        toolCall: { id: 'call-1', name: 'wiki__create_page', input: { title: 'Plan' } },
      }),
      { connectorTransport: () => fake.transport() },
    );
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('connections.add', {
      name: 'Wiki',
      transport: { type: 'http', url: 'https://wiki.example/mcp' },
      auth: 'none',
    });

    await host.call('ask', { petId: 'scout', input: { text: 'make a plan page' } });
    await vi.waitFor(() => expect(host.methods()).toContain('connector.confirm'), {
      timeout: 5000,
    });
    const confirm = host.notifications.find((n) => n.method === 'connector.confirm')!.params;
    expect(confirm).toMatchObject({ app: 'Wiki', tool: 'create_page', petId: 'scout' });
    expect(fake.calls).toEqual([]);

    const answered = await host.call('tool.approve', {
      approvalId: confirm['approvalId'],
      decision: 'once',
    });
    expect(answered['result']).toEqual({ accepted: true });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });
    expect(fake.calls).toEqual([{ name: 'create_page', args: { title: 'Plan' } }]);

    const activity = (await host.call('activity.list', {}))['result'] as {
      entries: { kind: string; app?: string; tool?: string; access?: string; state: string }[];
    };
    expect(activity.entries.find((entry) => entry.kind === 'connector')).toMatchObject({
      app: 'Wiki',
      tool: 'create_page',
      access: 'write',
      state: 'done',
    });
  });

  it('on a routine turn reads without asking, and a change still asks', async () => {
    // What the "What needs me" template relies on: its run never meets a card for a read.
    let rounds = 0;
    const readThenWrite: BrainProvider = {
      id: 'fake',
      capabilities: { vision: false, tools: true, streaming: true },
      listModels: () => Promise.resolve(['fake-model']),
      complete: async (_req, events) => {
        if (rounds++ === 0) {
          await events.onToolUse({ id: 'call-1', name: 'wiki__search', input: { q: 'me' } });
          await events.onToolUse({
            id: 'call-2',
            name: 'wiki__create_page',
            input: { title: 'X' },
          });
        }
        events.onText('One review waiting.');
        return {
          text: 'One review waiting.',
          stopReason: 'end',
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const fake = server();
    const e = await boot(readThenWrite, { connectorTransport: () => fake.transport() });
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('connections.add', {
      name: 'Wiki',
      transport: { type: 'http', url: 'https://wiki.example/mcp' },
      auth: 'none',
    });
    const saved = (
      await host.call('routines.save', {
        routine: {
          name: 'What needs me',
          when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '09:00' },
          what: 'List what is waiting on me across my connected apps.',
          uses: ['Wiki'],
        },
      })
    )['result'] as { routine: { id: string } };

    await host.call('routines.runNow', { id: saved.routine.id });
    await vi.waitFor(() => expect(host.methods()).toContain('connector.confirm'), {
      timeout: 5000,
    });
    // The read already ran, with no card; the only card is for the change.
    expect(fake.calls).toEqual([{ name: 'search', args: { q: 'me' } }]);
    const confirms = host.notifications.filter((n) => n.method === 'connector.confirm');
    expect(confirms.map((n) => n.params['tool'])).toEqual(['create_page']);

    await host.call('tool.approve', {
      approvalId: confirms[0]!.params['approvalId'],
      decision: 'deny',
    });
    await vi.waitFor(() => expect(host.methods()).toContain('routine.result'), { timeout: 5000 });
    expect(fake.calls).toEqual([{ name: 'search', args: { q: 'me' } }]);
  });
});

describe('providers.check', () => {
  it('tests the key once and says plainly when it fails', async () => {
    const refusing: BrainProvider = {
      id: 'fake',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: () => Promise.reject(new BrainError('auth', 'rejected')),
    };
    const e = await boot(refusing);
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const res = await host.call('providers.check', { providerId: 'openrouter' });
    expect(res['result']).toEqual({
      ok: false,
      message: expect.stringContaining('turned that key down'),
    });
  });

  it('writes no row in the log of what Scout saw: a key check sends no screen', async () => {
    const e = await boot(new FakeBrainProvider({ text: 'ok' }));
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('providers.check', { providerId: 'openrouter' });
    const seen = await host.call('sightLog.list', {});
    expect(seen['result']).toEqual({ entries: [] });
  });
});

describe('what Scout saw over rpc', () => {
  const entriesOf = (res: Record<string, unknown>) =>
    (res['result'] as { entries: Record<string, unknown>[] }).entries;

  it('logs a look and the send that carried it, by counts only', async () => {
    const e = await boot(
      new FakeBrainProvider({
        text: 'a spreadsheet',
        toolCall: { id: 'call-1', name: 'look_at_screen', input: {} },
      }),
    );
    const host = await TestHost.connect(e.port);
    host.onRequest = () => ({
      snapshot: {
        app: { name: 'notepad.exe', windowTitle: 'budget.txt' },
        screenshot: { mime: 'image/png', base64: 'iVBORw0KGgoPIXELS', width: 640, height: 480 },
      },
    });
    await host.call('hello', {
      ...helloParams(e.pairingToken),
      capabilities: ['selection', 'activeWindow', 'screenshot'] as const,
    });

    await host.call('ask', { petId: 'scout', input: { text: 'what is this?' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    const rows = entriesOf(await host.call('sightLog.list', {}));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'screenshot',
          app: 'notepad.exe',
          title: 'budget.txt',
          images: 1,
        }),
        expect.objectContaining({ kind: 'sent_to_ai', providerId: 'fake' }),
      ]),
    );
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain('PIXELS');
    expect(stored).not.toContain('what is this?');
  });

  it('logs the hotkey snapshot an ask arrives with: the title and the selection size', async () => {
    const e = await boot(new FakeBrainProvider({ text: 'ok' }));
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('ask', {
      petId: 'scout',
      input: { text: 'explain' },
      snapshot: {
        id: '6f1c2f0e-2a4b-4c1d-9e8f-0a1b2c3d4e5f',
        capturedAt: '2026-10-04T00:00:00.000Z',
        host: 'desktop',
        app: { name: 'Code.exe', windowTitle: 'main.ts' },
        selection: 'const x = 1;',
      },
    });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });

    const rows = entriesOf(await host.call('sightLog.list', {}));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'read_text',
          app: 'Code.exe',
          title: 'main.ts',
          chars: 12,
        }),
      ]),
    );
    expect(JSON.stringify(rows)).not.toContain('const x = 1;');
  });

  it('deletes one row and clears the rest', async () => {
    const e = await boot(new FakeBrainProvider({ text: 'ok' }));
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    await host.call('ask', { petId: 'scout', input: { text: 'hi' } });
    await vi.waitFor(() => expect(host.methods()).toContain('turn.completed'), { timeout: 5000 });
    await host.call('ask', { petId: 'scout', input: { text: 'again' } });
    await vi.waitFor(
      () => expect(host.methods().filter((m) => m === 'turn.completed')).toHaveLength(2),
      { timeout: 5000 },
    );

    const rows = entriesOf(await host.call('sightLog.list', {}));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const first = await host.call('sightLog.delete', { id: rows[0]!['id'] });
    expect(first['result']).toEqual({ deleted: true });
    const cleared = await host.call('sightLog.clear', {});
    // At least the rest; a background summary may have added a row meanwhile.
    expect((cleared['result'] as { deleted: number }).deleted).toBeGreaterThanOrEqual(
      rows.length - 1,
    );
    const left = entriesOf(await host.call('sightLog.list', {})).map((row) => row['id']);
    for (const row of rows) expect(left).not.toContain(row['id']);
  });

  it('is refused to the browser extension', async () => {
    const e = await boot();
    const ext = await TestHost.connect(e.port);
    await ext.call('hello', {
      host: 'extension',
      version: '0.0.0',
      capabilities: ['selection', 'pageText', 'activeWindow'],
      token: e.pairingToken,
    });
    for (const method of ['sightLog.list', 'sightLog.delete', 'sightLog.clear']) {
      const res = await ext.call(method, method === 'sightLog.delete' ? { id: 'x' } : {});
      expect(res['error']).toMatchObject({ code: RPC_ERROR_CODES.unauthorized });
    }
  });
});

describe('defaultConnectorFor', () => {
  const expert = {
    id: 'debugger',
    name: 'Debugger',
    goodAt: 'Finding why something breaks',
    enabled: true,
    instructions: 'Find the cause before you suggest a fix.',
    connection: { type: 'claude-code' as const, canEdit: false, canSearchWeb: true },
  };

  it('passes the standing instructions and web search on to Claude Code', () => {
    const connector = defaultConnectorFor({})(expert);
    expect(connector).toBeInstanceOf(ClaudeCodeConnector);
    expect(connector).toMatchObject({
      options: { instructions: 'Find the cause before you suggest a fix.', canSearchWeb: true },
    });
  });

  it('still hands back a fake connector in fake mode', () => {
    expect(defaultConnectorFor({ TAGALONG_FAKE_PROVIDERS: '1' })(expert)).toBeInstanceOf(
      FakeConnector,
    );
  });
});

describe('the calendar link', () => {
  it('keeps the link in the keychain, never in settings, and checks it with one fetch', async () => {
    const secrets = new InMemorySecretStore();
    const fetched: string[] = [];
    const soon = new Date(Date.now() + 3_600_000).toISOString().replace(/[-:]|\.\d{3}/g, '');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:soon@tagalong.test',
      `DTSTART:${soon}`,
      'SUMMARY:Design review',
      'DESCRIPTION:Agenda: onboarding.',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const e = await boot(undefined, {
      secretStore: secrets,
      calendarFetch: (url) => {
        fetched.push(url);
        return Promise.resolve(ics);
      },
    });
    const host = await TestHost.connect(e.port);
    await host.call('hello', helloParams(e.pairingToken));
    const link = 'https://calendar.example.com/private-abc/basic.ics';

    const set = await host.call('calendar.setLink', { link });
    expect(set['result']).toEqual({ linked: true, meetings: 1 });
    expect(await secrets.get('calendar.ics')).toBe(link);
    expect(fetched).toEqual([link]);
    const settings = await host.call('settings.get', {});
    expect(JSON.stringify(settings)).not.toContain('calendar.example.com');

    const refused = await host.call('calendar.setLink', { link: 'http://calendar.example.com/a' });
    expect(refused['error']).toBeDefined();
    expect(await secrets.get('calendar.ics')).toBe(link);

    await host.call('calendar.setLink', { link: null });
    expect(await secrets.get('calendar.ics')).toBeNull();
    expect((await host.call('calendar.check', {}))['result']).toEqual({
      linked: false,
      meetings: 0,
    });
  });
});
