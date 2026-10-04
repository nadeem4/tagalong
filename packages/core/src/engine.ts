import type { Database } from 'better-sqlite3';
import { DEFAULT_ENGINE_PORT, Settings } from '@tagalong/protocol';
import type { Pet } from '@tagalong/protocol';
import { openDatabase } from './memory/db';
import { ConversationStore } from './memory/store';
import { PetRegistry } from './pets/registry';
import { SettingsStore } from './settings/settings';
import type { SecretStore } from './settings/settings';
import { createProvider } from './providers';
import type { BrainProvider } from './providers';
import type { ProviderResolver } from './conversation/runner';
import { ConversationRunner } from './conversation';
import { createPerceptionToolset } from './perception';
import { EngineServer } from './server/ws-server';
import type { MethodHandlers } from './server/ws-server';
import { readOrCreatePairingToken } from './server/pairing';

/** Key the Anthropic API key is filed under in the host's SecretStore. */
export const ANTHROPIC_KEY = 'anthropic.apiKey';

/** Which SecretStore entry holds the key for each provider id that needs one. */
const PROVIDER_KEYS: Readonly<Record<string, string>> = {
  anthropic: ANTHROPIC_KEY,
};

/**
 * Builds each pet's provider the first time a turn needs it, then reuses it.
 *
 * Keys are read once, at boot: a key saved in Settings applies from the next launch,
 * which is what the settings window already promises. A provider that cannot be built —
 * no key, an unknown id — is not cached, so the error is raised on the turn that hit it
 * and reported as that turn's `turn.error` rather than failing boot for every pet.
 */
async function providerResolver(
  secrets: SecretStore,
  env: Record<string, string | undefined> | undefined,
): Promise<ProviderResolver> {
  const keys = new Map<string, string>();
  for (const [providerId, secretKey] of Object.entries(PROVIDER_KEYS)) {
    const value = await secrets.get(secretKey);
    if (value !== null && value.length > 0) keys.set(providerId, value);
  }
  const built = new Map<string, BrainProvider>();
  return (pet) => {
    const cached = built.get(pet.providerId);
    if (cached !== undefined) return cached;
    const provider = createProvider({
      providerId: pet.providerId,
      apiKey: keys.get(pet.providerId),
      env,
    });
    built.set(pet.providerId, provider);
    return provider;
  };
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
    const provider = options.provider ?? (await providerResolver(options.secretStore, options.env));

    const store = new ConversationStore(db);

    // The runner needs an event sink before the server exists, and the server needs the
    // runner's handlers before it starts. The holder ties that knot without a mutable
    // binding: no turn can run before boot returns, so the sink is never called empty.
    const live: { server?: EngineServer } = {};
    const runner = new ConversationRunner({
      store,
      settings,
      provider,
      emit: (event) => live.server?.broadcast(event.method, event.params),
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

    const handlers = buildHandlers({ runner, pets, settings });

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
  pets: PetRegistry;
  settings: SettingsStore;
}): MethodHandlers {
  const { runner, pets, settings } = parts;

  return {
    ask: (params) => {
      const pet = pets.get(params.petId);
      if (pet === null) throw new Error(`no pet with id '${params.petId}'`);
      // Phase 3 transcribes params.input.audio; Phase 1 is text only.
      const handle = runner.run({
        pet,
        text: params.input.text ?? '',
        conversationId: params.conversationId,
        snapshot: params.snapshot,
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
  };
}
