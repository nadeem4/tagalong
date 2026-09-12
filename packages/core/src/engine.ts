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
import { ConversationRunner } from './conversation';
import { EngineServer } from './server/ws-server';
import type { MethodHandlers } from './server/ws-server';
import { readOrCreatePairingToken } from './server/pairing';

/** Key the Anthropic API key is filed under in the host's SecretStore. */
export const ANTHROPIC_KEY = 'anthropic.apiKey';

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
    const provider =
      options.provider ??
      createProvider({
        providerId: current.providerId,
        apiKey: (await options.secretStore.get(ANTHROPIC_KEY)) ?? undefined,
        env: options.env,
      });

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
