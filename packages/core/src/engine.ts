import type { Database } from 'better-sqlite3';
import { DEFAULT_ENGINE_PORT, RPC_ERROR_CODES, Settings } from '@tagalong/protocol';
import type { Expert, Pet, Role } from '@tagalong/protocol';
import { openDatabase } from './memory/db';
import { ActivityLog } from './memory/activity';
import { ConversationStore } from './memory/store';
import { MemoryStore } from './memory/memories';
import { Summarizer } from './memory/summarizer';
import { PetRegistry } from './pets/registry';
import { SettingsStore } from './settings/settings';
import type { SecretStore } from './settings/settings';
import {
  ANTHROPIC_MODELS,
  FAKE_MODELS,
  KeyedProviderResolver,
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
import { browserContextFor } from './perception';
import type { PerceptionHost } from './perception';
import { WatchManager, systemWatchClock } from './watch';
import { dismissRolesNotice, rolesUpgradeNotice } from './pets/roles-notice';
import { getRole, listRoles, recommendedModel } from './roles';
import { EngineServer, RpcFailure } from './server/ws-server';
import {
  ClaudeCodeConnector,
  ExpertStore,
  FakeConnector,
  HandoffManager,
  RouteMemory,
  type Connector,
} from './experts';
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

/** The library role with this id, or an invalidParams refusal naming the id. */
function knownRole(roleId: string): Role {
  const role = getRole(roleId);
  if (role === undefined) {
    throw new RpcFailure(RPC_ERROR_CODES.invalidParams, `no role '${roleId}' in the role library`);
  }
  return role;
}

/**
 * A pet about to be saved, with its role checked. A new pet, or one moving to another role,
 * takes on that role's library version; an existing pet keeps the version it was sent with.
 */
function withRole(pet: Pet, existing: Pet | null): Pet {
  const role = knownRole(pet.roleId);
  if (existing !== null && existing.roleId === pet.roleId) return pet;
  return { ...pet, roleVersion: role.version };
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
  /** How an expert is reached. Defaults to its real connector, or a fake one in fake mode. */
  connectorFor?: ((expert: Expert) => Connector) | undefined;
}

/**
 * The connector behind an expert. Fake mode never starts a real tool, the same rule the
 * brain providers follow, so a test or a demo cannot spend the user's Claude Code usage.
 */
function defaultConnectorFor(env: Record<string, string | undefined>) {
  return (expert: Expert): Connector => {
    if (env.TAGALONG_FAKE_PROVIDERS === '1') {
      return new FakeConnector({
        steps: ['Reading the brief'],
        text: `${expert.name} (fake) read the brief and has nothing to change.`,
      });
    }
    const { folder, canEdit, command } = expert.connection;
    return new ClaudeCodeConnector({ folder, canEdit, ...(command ? { command } : {}) });
  };
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
  readonly #watches: WatchManager;
  readonly #handoffs: HandoffManager;

  private constructor(parts: {
    db: Database;
    server: EngineServer;
    runner: ConversationRunner;
    pets: PetRegistry;
    settings: SettingsStore;
    token: string;
    watches: WatchManager;
    handoffs: HandoffManager;
  }) {
    this.#watches = parts.watches;
    this.#handoffs = parts.handoffs;
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
    // Each pet names its own provider, so there is no single brain to build at boot. Keys
    // are re-read before every ask, so one saved while the app runs answers the next turn.
    const keyed =
      options.provider === undefined
        ? new KeyedProviderResolver({
            secrets: options.secretStore,
            baseUrl: (providerId) => settings.get().providerBaseUrls[providerId],
            env: options.env,
          })
        : null;
    await keyed?.refresh();
    const provider: BrainProvider | ProviderResolver =
      options.provider ?? ((pet: Pet) => keyed!.resolve(pet));

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
    // Home's activity record is written before the broadcast, so a host that re-reads
    // activity.list on a notification already finds the row.
    const activity = new ActivityLog(db, store);
    const emit: TurnEventSink = (event) => {
      activity.observe(event);
      live.server?.broadcast(event.method, event.params);
    };
    const hosts = (): readonly PerceptionHost[] => live.server?.sessions() ?? [];
    // Phase 3B. Watches outlive the turn that started them, so they belong to the engine.
    const watches = new WatchManager({
      clock: systemWatchClock,
      hosts,
      provider: resolve,
      // Read when a watch starts, so limits saved in Settings apply to the next one.
      limits: () => settings.get().watch,
      emit: (event) => live.server?.broadcast(event.method, event.params),
      log: (message) => console.warn(`[engine] ${message}`),
    });
    const experts = new ExpertStore(db);
    const connectorFor = options.connectorFor ?? defaultConnectorFor(options.env ?? process.env);
    const handoffs = new HandoffManager({
      experts,
      activity,
      connectorFor,
      emit: (event) => live.server?.broadcast(event.method, event.params),
    });
    const routes = new RouteMemory(db);
    const runner = new ConversationRunner({
      store,
      settings,
      provider,
      emit,
      memory,
      // Off the request path: the reply is already on screen when the summary starts.
      afterTurn: ({ pet, conversationId }) => void summarizer.schedule(conversationId, pet),
      consult: {
        pets: () => pets.list(),
        answered: (turnId, toPetId, outcome) => activity.consultAnswered(turnId, toPetId, outcome),
      },
      watch: { manager: watches, hosts },
      // Read per turn: experts are added and switched off while the app runs.
      experts: {
        experts: () => experts.list(),
        routes,
        start: (params) => handoffs.start(params),
      },
      // Both lookups are lazy: hosts connect and drop between turns, and the exclusion
      // list is edited while the app runs, so neither can be captured at boot.
      perception: {
        hosts: () => live.server?.sessions() ?? [],
        exclusions: () => settings.get().captureExclusions,
        // Lazy for the same reason: the cap is a cost control the user edits in Settings,
        // and reading it at boot would make saving it do nothing until the next launch.
        windowTextBudget: () => settings.get().windowTextBudget,
        // No `vision` here: whether a look returns pixels depends on the pet asking, so
        // the runner passes it with every tool call.
      },
    });

    const handlers = buildHandlers({
      db,
      activity,
      runner,
      store,
      emit,
      pets,
      settings,
      hosts,
      watches,
      experts,
      routes,
      handoffs,
      connectorFor,
      refreshProviders: async () => keyed?.refresh(),
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
      watches,
      handoffs,
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
    this.#watches.stopAll();
    await this.#handoffs.stopAll();
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
  /** For the one-time notices; everything else reaches it through its own store. */
  db: Database;
  activity: ActivityLog;
  runner: ConversationRunner;
  store: ConversationStore;
  emit: TurnEventSink;
  pets: PetRegistry;
  settings: SettingsStore;
  /** Lazy, like the toolset's: the extension connects and drops while the app runs. */
  hosts: () => readonly PerceptionHost[];
  watches: WatchManager;
  experts: ExpertStore;
  routes: RouteMemory;
  handoffs: HandoffManager;
  connectorFor: (expert: Expert) => Connector;
  models: (providerId: string) => Promise<{ models: string[]; source: 'live' | 'fallback' }>;
  /** Re-reads provider keys, so a key saved since the last ask is used by this one. */
  refreshProviders: () => Promise<void>;
}): MethodHandlers {
  const { db, activity, runner, store, emit, pets, settings, models, hosts, watches } = parts;
  const { refreshProviders, experts, routes, handoffs, connectorFor } = parts;

  return {
    ask: async (params) => {
      const pet = pets.get(params.petId);
      if (pet === null) throw new Error(`no pet with id '${params.petId}'`);
      await refreshProviders();
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
    'pets.upsert': (params) => ({
      pet: pets.upsert(withRole(params.pet, pets.get(params.pet.id))),
    }),
    'pets.delete': (params) => ({ deleted: pets.delete(params.petId) }),

    'settings.get': () => ({ settings: settings.get() }),
    'settings.set': (params) => ({ settings: settings.set(params.patch) }),
    'models.list': (params) => models(params.providerId),
    'watch.stop': (params) => ({ stopped: watches.stop(params.watchId) }),

    'roles.list': () => ({ roles: [...listRoles()] }),
    'roles.recommendModel': (params) =>
      recommendedModel(knownRole(params.roleId), params.providerId) ?? {},

    'notices.rolesUpgrade': () => ({ notice: rolesUpgradeNotice(db) }),
    // `rolesUpgrade` is the only notice so far; the params schema refuses any other name.
    'notices.dismiss': () => ({ dismissed: dismissRolesNotice(db) }),

    'activity.list': (params) => activity.list(params),

    'experts.list': () => ({ experts: experts.list() }),
    'experts.upsert': (params) => ({ expert: experts.upsert(params.expert) }),
    'experts.delete': (params) => {
      routes.forgetExpert(params.expertId);
      return { deleted: experts.delete(params.expertId) };
    },
    'experts.test': async (params) => {
      const expert = experts.get(params.expertId);
      if (expert === null) {
        throw new RpcFailure(
          RPC_ERROR_CODES.invalidParams,
          `no expert with id '${params.expertId}'`,
        );
      }
      return connectorFor(expert).check();
    },
    'handoffs.start': (params) => handoffs.start(params),
    'handoffs.cancel': (params) => ({ cancelled: handoffs.cancel(params.handoffId) }),
  };
}
