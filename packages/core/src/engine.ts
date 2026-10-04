import type { Database } from 'better-sqlite3';
import { DEFAULT_ENGINE_PORT, Settings } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import { openDatabase } from './memory/db';
import { ConversationStore } from './memory/store';
import { MemoryStore } from './memory/memories';
import { Summarizer } from './memory/summarizer';
import { PetRegistry } from './pets/registry';
import { SettingsStore } from './settings/settings';
import type { SecretStore } from './settings/settings';
import {
  ANTHROPIC_MODELS,
  FAKE_MODELS,
  OpenAiCompatibleProvider,
  SECRET_KEYS,
  createProvider,
  openAiPreset,
} from './providers';
import type { BrainProvider } from './providers';
import type { ProviderResolver } from './conversation/runner';
import { ConversationRunner } from './conversation';
import type { TurnEventSink } from './conversation/runner';
import { parseCrewCommand } from './crew/commands';
import { startHandoff } from './crew/handoff';
import { startRoundtable } from './crew/roundtable';
import { browserContextFor, createPerceptionToolset } from './perception';
import type { PerceptionHost } from './perception';
import { EngineServer } from './server/ws-server';
import type { MethodHandlers } from './server/ws-server';
import { readOrCreatePairingToken } from './server/pairing';

/** Key the Anthropic API key is filed under in the host's SecretStore. */
export const ANTHROPIC_KEY = SECRET_KEYS.anthropic!;

async function readKey(secrets: SecretStore, providerId: string): Promise<string | undefined> {
  const secretKey = SECRET_KEYS[providerId];
  if (secretKey === undefined) return undefined;
  const value = await secrets.get(secretKey);
  return value !== null && value.length > 0 ? value : undefined;
}

/**
 * Builds each pet's provider the first time a turn needs it, then reuses it.
 *
 * Keys are read once, at boot: a key saved in Settings applies from the next launch,
 * which is what the settings window already promises. Base URLs are read when a
 * provider is first built. A provider that cannot be built — no key, an unknown id — is
 * not cached, so the error is raised on the turn that hit it and reported as that
 * turn's `turn.error` rather than failing boot for every pet.
 */
async function providerResolver(
  secrets: SecretStore,
  settings: SettingsStore,
  env: Record<string, string | undefined> | undefined,
): Promise<ProviderResolver> {
  const keys = new Map<string, string>();
  for (const providerId of Object.keys(SECRET_KEYS)) {
    const value = await readKey(secrets, providerId);
    if (value !== undefined) keys.set(providerId, value);
  }
  const built = new Map<string, BrainProvider>();
  return (pet) => {
    const cached = built.get(pet.providerId);
    if (cached !== undefined) return cached;
    const provider = createProvider({
      providerId: pet.providerId,
      apiKey: keys.get(pet.providerId),
      baseURL: settings.get().providerBaseUrls[pet.providerId],
      env,
    });
    built.set(pet.providerId, provider);
    return provider;
  };
}

/**
 * The models Settings offers for one provider.
 *
 * The key is read fresh here, unlike the turn path, so a key saved a moment ago fills the
 * picker without a restart. Fake mode never asks the network, and any failure to reach
 * the service — offline, a refused key, a wrong base URL — falls back to the built-in
 * list and says so, because an empty picker is worse than a short one.
 */
async function listModels(
  providerId: string,
  secrets: SecretStore,
  settings: SettingsStore,
  env: Record<string, string | undefined>,
): Promise<{ models: string[]; source: 'live' | 'fallback' }> {
  const preset = openAiPreset(providerId);
  if (preset !== undefined) {
    const fallback = { models: [...preset.fallbackModels], source: 'fallback' as const };
    const apiKey = await readKey(secrets, providerId);
    if (apiKey === undefined || env.TAGALONG_FAKE_PROVIDERS === '1') return fallback;
    const provider = createProvider({
      providerId,
      apiKey,
      baseURL: settings.get().providerBaseUrls[providerId],
      env,
    });
    if (!(provider instanceof OpenAiCompatibleProvider)) return fallback;
    try {
      return { models: await provider.fetchModels(), source: 'live' };
    } catch {
      return fallback;
    }
  }
  if (providerId === 'anthropic') return { models: [...ANTHROPIC_MODELS], source: 'fallback' };
  if (providerId === 'fake') return { models: [...FAKE_MODELS], source: 'fallback' };
  throw new Error(`no provider with id '${providerId}'`);
}

export interface EngineOptions {
  /** Where the database, settings, and pairing token live. The host picks this. */
  dataDir: string;
  secretStore: SecretStore;
  engineVersion: string;
  /** Overrides the port in settings. Tests pass 0 to let the OS choose. */
  port?: number | undefined;
  /** Injected so a test can set TAGALONG_FAKE_PROVIDERS without touching the process. */
  env?: Record<string, string | undefined> | undefined;
  /** Skips the registry entirely. Only tests that script a provider need this. */
  provider?: BrainProvider | undefined;
}

/**
 * Everything the engine owns, wired together and listening.
 *
 * The facade exists so a host has exactly one thing to start and stop. Hosts never
 * touch the store, the runner, or the provider directly — they speak the protocol,
 * which is what keeps the Electron host and the Chrome host interchangeable.
 */
export class Engine {
  readonly #db: Database;
  readonly #server: EngineServer;
  readonly #runner: ConversationRunner;
  readonly #pets: PetRegistry;
  readonly #settings: SettingsStore;
  readonly #token: string;

  private constructor(parts: {
    db: Database;
    server: EngineServer;
    runner: ConversationRunner;
    pets: PetRegistry;
    settings: SettingsStore;
    token: string;
  }) {
    this.#db = parts.db;
    this.#server = parts.server;
    this.#runner = parts.runner;
    this.#pets = parts.pets;
    this.#settings = parts.settings;
    this.#token = parts.token;
  }

  static async boot(options: EngineOptions): Promise<Engine> {
    const db = openDatabase(options.dataDir);
    const settings = new SettingsStore(options.dataDir);
    const pets = new PetRegistry(db);
    pets.seedDefaults();

    const current = settings.get();
    // Each pet names its own provider, so there is no single brain to build at boot.
    const provider =
      options.provider ?? (await providerResolver(options.secretStore, settings, options.env));

    const store = new ConversationStore(db);
    const memory = new MemoryStore(db);
    const resolve: ProviderResolver =
      typeof provider === 'function' ? provider : () => provider as BrainProvider;
    const summarizer = new Summarizer({
      store,
      memories: memory,
      settings,
      provider: resolve,
      onError: (error) => console.warn('[engine] a conversation summary failed:', error),
    });

    // The runner needs an event sink before the server exists, and the server needs the
    // runner's handlers before it starts. The holder ties that knot without a mutable
    // binding: no turn can run before boot returns, so the sink is never called empty.
    const live: { server?: EngineServer } = {};
    const emit: TurnEventSink = (event) => live.server?.broadcast(event.method, event.params);
    const runner = new ConversationRunner({
      store,
      settings,
      provider,
      emit,
      memory,
      // Off the request path: the reply is already on screen when the summary starts.
      afterTurn: ({ pet, conversationId }) => void summarizer.schedule(conversationId, pet),
      consult: { pets: () => pets.list() },
      // Both lookups are lazy: hosts connect and drop between turns, and the exclusion
      // list is edited while the app runs, so neither can be captured at boot.
      tools: createPerceptionToolset({
        hosts: () => live.server?.sessions() ?? [],
        exclusions: () => settings.get().captureExclusions,
        // Lazy for the same reason: the cap is a cost control the user edits in Settings,
        // and reading it at boot would make saving it do nothing until the next launch.
        windowTextBudget: () => settings.get().windowTextBudget,
        // No `vision` here: whether a look returns pixels depends on the pet asking, so
        // the runner passes it with every tool call.
      }),
    });

    const handlers = buildHandlers({
      runner,
      store,
      emit,
      pets,
      settings,
      hosts: () => live.server?.sessions() ?? [],
      models: (providerId) =>
        listModels(providerId, options.secretStore, settings, options.env ?? process.env),
    });

    const server = await EngineServer.start({
      port: options.port ?? current.enginePort ?? DEFAULT_ENGINE_PORT,
      token: readOrCreatePairingToken(options.dataDir),
      engineVersion: options.engineVersion,
      listPets: () => pets.list(),
      handlers,
    });

    live.server = server;

    return new Engine({
      db,
      server,
      runner,
      pets,
      settings,
      token: readOrCreatePairingToken(options.dataDir),
    });
  }

  /** The port actually bound, which differs from settings when the host passed 0. */
  get port(): number {
    return this.#server.port;
  }

  /** Hosts must present this in hello. The desktop host reads the file directly. */
  get pairingToken(): string {
    return this.#token;
  }

  /** Exposed for the acceptance test that restarts the app and expects its history. */
  conversationCount(): number {
    const row = this.#db
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM conversations')
      .get();
    return row?.count ?? 0;
  }

  async shutdown(): Promise<void> {
    this.#runner.interruptAll();
    await this.#server.close();
    this.#db.close();
  }

  /** Present so the field is read; the registry is reached through RPC handlers. */
  get settings(): Settings {
    return this.#settings.get();
  }

  get pets(): Pet[] {
    return this.#pets.list();
  }
}

function buildHandlers(parts: {
  runner: ConversationRunner;
  store: ConversationStore;
  emit: TurnEventSink;
  pets: PetRegistry;
  settings: SettingsStore;
  /** Lazy, like the toolset's: the extension connects and drops while the app runs. */
  hosts: () => readonly PerceptionHost[];
  models: (providerId: string) => Promise<{ models: string[]; source: 'live' | 'fallback' }>;
}): MethodHandlers {
  const { runner, store, emit, pets, settings, models, hosts } = parts;

  return {
    ask: async (params) => {
      const pet = pets.get(params.petId);
      if (pet === null) throw new Error(`no pet with id '${params.petId}'`);
      // A desktop hotkey pressed in a browser gets the extension's exact selection and the
      // page text, when the extension answers within half a second.
      const snapshot = await browserContextFor(params.snapshot, {
        hosts: hosts(),
        exclusions: settings.get().captureExclusions,
      });
      // Phase 3 transcribes params.input.audio; Phase 1 is text only.
      const command = parseCrewCommand(params.input.text ?? '', pets.list(), pet.id);
      if (command.kind === 'handoff') {
        const handle = startHandoff(
          { runner, store, emit },
          {
            from: pet,
            to: command.target,
            conversationId: params.conversationId,
            request: command.request,
            snapshot,
          },
        );
        return { turnId: handle.turnId };
      }
      if (command.kind === 'roundtable') {
        // The whole crew, the asked pet first; the run reports itself through crew.status.
        const run = startRoundtable(
          { runner, emit },
          { starter: pet, pets: pets.list(), question: command.question, snapshot },
        );
        return { turnId: run.firstTurnId };
      }
      const handle = runner.run({
        pet,
        text: command.text,
        conversationId: params.conversationId,
        snapshot,
      });
      // The turn keeps running after this resolves; progress arrives as notifications.
      return { turnId: handle.turnId };
    },

    interrupt: (params) => ({ aborted: runner.interrupt(params.turnId) }),

    'pets.list': () => ({ pets: pets.list() }),
    'pets.upsert': (params) => ({ pet: pets.upsert(params.pet) }),
    'pets.delete': (params) => ({ deleted: pets.delete(params.petId) }),

    'settings.get': () => ({ settings: settings.get() }),
    'settings.set': (params) => ({ settings: settings.set(params.patch) }),
    'models.list': (params) => models(params.providerId),
  };
}
