/**
 * The engine facade: boots every store, manager and the socket server, and wires them
 * together. Contains `Engine` (boot, port, pairingToken, shutdown), `defaultConnectorFor`,
 * and the JSON-RPC handler table hosts call. The desktop host starts one `Engine`; hosts
 * only ever talk to it over the protocol.
 */
import { guardBrain } from './providers/guard';
import { checkKey } from './providers/check-key';
import type { Database } from 'better-sqlite3';
import { DEFAULT_ENGINE_PORT, RPC_ERROR_CODES, SCOUT_ID } from '@tagalong/protocol';
import type { Expert, HostKind, Pet } from '@tagalong/protocol';
import { openDatabase } from './memory/db';
import { ActivityLog } from './memory/activity';
import { ConversationStore } from './memory/store';
import { MemoryStore } from './memory/memories';
import { Summarizer } from './memory/summarizer';
import { composeGreeting } from './greeting/greeting';
import { launchScenario } from './greeting/scenario';
import { PetRegistry } from './pets/registry';
import { SettingsStore } from './settings/settings';
import type { SecretStore } from './settings/settings';
import {
  ANTHROPIC_MODELS,
  CLAUDE_CODE_MODELS,
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
import { browserContextFor } from './perception';
import type { PerceptionHost } from './perception';
import { WatchManager, systemWatchClock } from './watch';
import { KeepAnEye } from './keep-an-eye/keep-an-eye';
import { moodForHandoff } from './keep-an-eye/mood';
import { Wellbeing } from './wellbeing';
import { getRole } from './roles';
import { EngineServer, RpcFailure } from './server/ws-server';
import {
  ClaudeCodeConnector,
  ExpertStore,
  FakeConnector,
  HandoffManager,
  type Connector,
} from './experts';
import {
  ProjectFinder,
  ProjectMemory,
  defaultProjectRoots,
  listChildDirs,
  looksLikeProject,
} from './projects/finder';
import type { MethodHandlers } from './server/ws-server';
import {
  Approvals,
  ConnectionManager,
  ConnectionStore,
  POPULAR_CONNECTORS,
  readClaudeCodeConnectors,
  type TransportFor,
} from './connections';
import { readOrCreatePairingToken } from './server/pairing';
import { RoutineStore, Routines } from './routines';
import { PickUp, readBranch } from './pick-up/pick-up';
import { PickUpStore } from './pick-up/store';
import { HistorySearch } from './memory/history-search';
import { SightLog } from './memory/sight-log';
import { recordSnapshot, sightedHosts } from './perception/record-sight';
import { recordBrain } from './providers/record-brain';
import { recordExpertSends } from './experts/record-expert';
import { CalendarFeed, httpsFetchText, type FetchText } from './meetings/calendar-feed';
import { UsageLog, budgetSpent, meterBrain } from './usage';
import {
  CATALOG,
  catalogBundle,
  catalogEntry,
  catalogStatus,
  fromCatalog,
} from './experts/catalog';
import {
  claudePluginsRoot,
  connectedApps,
  installedPlugins,
  installMissing,
  installPlugin,
  userAllowRules,
} from './experts/claude-setup';
import type { SpawnFn } from './experts/claude-code';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
  // The Claude sign-in names its models by alias; there is no list to fetch.
  if (providerId === 'claude-code') return { models: [...CLAUDE_CODE_MODELS], source: 'fallback' };
  throw new Error(`no provider with id '${providerId}'`);
}

/** The routines, which exist by the time any turn can call a routine tool. */
function routinesOf(live: { routines?: Routines }): Routines {
  if (live.routines === undefined) throw new Error('routines are not running yet');
  return live.routines;
}

/**
 * A pet about to be saved, checked: it must be Scout, the one pet there is, and its role
 * must be in the library. Either refusal is invalidParams.
 */
function checkedPet(pet: Pet): Pet {
  if (pet.id !== SCOUT_ID) {
    throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'there is only Scout');
  }
  if (getRole(pet.roleId) === undefined) {
    throw new RpcFailure(
      RPC_ERROR_CODES.invalidParams,
      `no role '${pet.roleId}' in the role library`,
    );
  }
  return pet;
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
  connectorFor?: ((expert: Expert, mode?: { research: boolean }) => Connector) | undefined;
  /** Where the project finder looks for code. Tests point it at a temporary folder. */
  projectRoots?: (() => string[]) | undefined;
  /** Opens the system browser for an app's sign-in. The host owns it. */
  openBrowser?: ((url: string) => void | Promise<void>) | undefined;
  /** Tests connect to in-memory MCP servers instead of the network. */
  connectorTransport?: TransportFor | undefined;
  /** Claude Code's config, read-only, for Found on this PC. Defaults to `~/.claude.json`. */
  claudeCodeConfigPath?: string | undefined;
  /** How Meeting prep's .ics link is fetched. Tests pass a fake; never the network. */
  calendarFetch?: FetchText | undefined;
  /** Claude Code's plugins folder, read-only. Defaults to `~/.claude/plugins`. */
  claudePluginsRoot?: string | undefined;
  /** Starts `claude plugin install`. Tests pass a fake; fake mode never starts one. */
  claudeSpawn?: SpawnFn | undefined;
}

/**
 * The connector behind an expert. Fake mode never starts a real tool, the same rule the
 * brain providers follow, so a test or a demo cannot spend the user's Claude Code usage.
 */
export function defaultConnectorFor(
  env: Record<string, string | undefined>,
  pluginsRoot: string = claudePluginsRoot(),
) {
  return (expert: Expert, mode?: { research: boolean }): Connector => {
    if (env.TAGALONG_FAKE_PROVIDERS === '1') {
      return new FakeConnector({
        steps: ['Reading the brief'],
        text: `${expert.name} (fake) read the brief and has nothing to change.`,
      });
    }
    const { folder, canEdit, canSearchWeb, command } = expert.connection;
    // Only an expert installed from the catalog runs with plugins and apps, and its bundle
    // comes from catalog.json, never from the saved row.
    const bundle = catalogBundle(expert);
    const workspace = bundle?.workspace ?? expert.connection.workspace;
    const unsealed =
      bundle !== undefined && (bundle.plugins.length > 0 || bundle.mcpTools.length > 0);
    return new ClaudeCodeConnector({
      canEdit,
      canSearchWeb,
      instructions: expert.instructions,
      ...(folder !== undefined ? { folder } : {}),
      ...(command ? { command } : {}),
      ...(mode?.research === true ? { research: true } : {}),
      ...(unsealed
        ? {
            plugins: bundle.plugins,
            mcpTools: bundle.mcpTools,
            installedPlugins: () => installedPlugins(pluginsRoot),
            userAllowRules: () => userAllowRules(join(dirname(pluginsRoot), 'settings.json')),
          }
        : {}),
      ...(workspace === 'own' ? { ownFolder: join(tmpdir(), 'tagalong-experts', expert.id) } : {}),
    });
  };
}

/**
 * Everything the engine owns, wired together and listening.
 *
 * The facade exists so a host has exactly one thing to start and stop. Hosts never
 * touch the store, the runner, or the provider directly: they speak the protocol.
 */
export class Engine {
  readonly #db: Database;
  readonly #server: EngineServer;
  readonly #runner: ConversationRunner;
  readonly #token: string;
  readonly #watches: WatchManager;
  readonly #handoffs: HandoffManager;
  readonly #connections: ConnectionManager;
  readonly #routines: Routines;
  readonly #pickUp: PickUp;

  private constructor(parts: {
    db: Database;
    server: EngineServer;
    runner: ConversationRunner;
    token: string;
    watches: WatchManager;
    handoffs: HandoffManager;
    connections: ConnectionManager;
    routines: Routines;
    pickUp: PickUp;
  }) {
    this.#pickUp = parts.pickUp;
    this.#routines = parts.routines;
    this.#connections = parts.connections;
    this.#watches = parts.watches;
    this.#handoffs = parts.handoffs;
    this.#db = parts.db;
    this.#server = parts.server;
    this.#runner = parts.runner;
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
    // What Scout saw: every look and every send, as metadata. Old rows go at boot too.
    const sightLog = new SightLog(db, {
      days: () => settings.get().sightLog.days,
      exclusions: () => settings.get().captureExclusions,
    });
    sightLog.prune();
    // The cost meter: counts only, in the person's zone. One gate for all proactive work.
    const usage = new UsageLog(db, {
      now: () => Date.now(),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const spentOut = budgetSpent(usage, () => settings.get().budget.dailyUsd);
    // Every brain is guarded: no key, token or password in anything sent reaches a model.
    const guarded: ProviderResolver = (pet) =>
      guardBrain(typeof provider === 'function' ? provider(pet) : provider);
    // And recorded: each call writes one "Sent to AI" row. Metered outermost: every call
    // through here is counted, so nothing new can skip it.
    const resolve: ProviderResolver = (pet) =>
      meterBrain(recordBrain(guarded(pet), sightLog), (call) =>
        usage.record({ source: 'scout', ...call }),
      );
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
    const live: { server?: EngineServer; routines?: Routines } = {};
    // Home's activity record is written before the broadcast, so a host that re-reads
    // activity.list on a notification already finds the row.
    const activity = new ActivityLog(db, store);
    // Nothing runs yet, so anything still marked running was cut short by a crash or quit.
    // The count is kept for the launch line, which names it only after a crash.
    const interruptedAtBoot = activity.interrupted();
    const routineStore = new RoutineStore(db);
    routineStore.interrupted();
    const emit: TurnEventSink = (event) => {
      activity.observe(event);
      live.server?.broadcast(event.method, event.params);
    };
    // Every read through a host writes a row to the log of what Scout saw.
    const hosts = sightedHosts<PerceptionHost>(() => live.server?.sessions() ?? [], sightLog);
    // Watches outlive the turn that started them, so they belong to the engine.
    const watches = new WatchManager({
      clock: systemWatchClock,
      hosts,
      provider: resolve,
      // Read when a watch starts, so limits saved in Settings apply to the next one.
      limits: () => settings.get().watch,
      emit: (event) => {
        live.server?.broadcast(event.method, event.params);
        if (event.method === 'watch.fired') live.routines?.watchFired(event.params.message);
      },
      log: (message) => console.warn(`[engine] ${message}`),
    });
    const experts = new ExpertStore(db);
    const connectorFor = recordExpertSends(
      options.connectorFor ??
        defaultConnectorFor(options.env ?? process.env, options.claudePluginsRoot),
      sightLog,
    );
    const projects = new ProjectFinder({
      memory: new ProjectMemory(db),
      roots: options.projectRoots ?? defaultProjectRoots,
      listDirs: listChildDirs,
      isProject: looksLikeProject,
    });
    const handoffs = new HandoffManager({
      experts,
      activity,
      connectorFor,
      emit: (event) => {
        live.server?.broadcast(event.method, event.params);
        if (event.method !== 'handoff.finished') return;
        live.routines?.handoffFinished(event.params);
        // A wince at an error, a cheer when tests pass; a plain finish keeps the done face.
        const mood = moodForHandoff(event.params);
        if (mood !== null) {
          live.server?.broadcast('pet.mood', { petId: SCOUT_ID, mood });
        }
      },
      projects,
      usage,
    });
    const pickUpStore = new PickUpStore(db);
    /** What is open, titles only: null with no host connected, empty when none can list. */
    const listHostWindows = async () => {
      const connected = hosts();
      if (connected.length === 0) return null;
      const lister = connected.find(
        (host) => host.capabilities.includes('displays') && host.listWindows !== undefined,
      );
      if (lister?.listWindows === undefined) return [];
      try {
        return (await lister.listWindows()).windows;
      } catch {
        return [];
      }
    };
    // Keep an eye on things: the host sends window titles, and now and then one window is
    // read and one cheap call decides whether Scout has anything worth saying.
    const keepAnEye = new KeepAnEye({
      clock: { now: () => Date.now() },
      settings: () => settings.get(),
      pet: () => pets.get(SCOUT_ID),
      hosts,
      provider: resolve,
      experts: () => experts.list(),
      propose: (params) => handoffs.propose(params),
      emit: (event) => live.server?.broadcast(event.method, event.params),
      log: (message) => console.warn(`[engine] ${message}`),
      spentOut,
    });
    // Gentle nudges: idle time and titles once a minute, fixed lines, no model call.
    const wellbeing = new Wellbeing({
      clock: { now: () => Date.now() },
      settings: () => settings.get(),
      pet: () => pets.get(SCOUT_ID),
      experts: () => experts.list(),
      propose: (params) => handoffs.propose(params),
      emit: (event) => live.server?.broadcast(event.method, event.params),
    });
    // The person's apps over MCP. Each connects on its own; one that fails never stops boot.
    const connections = new ConnectionManager({
      store: new ConnectionStore(db),
      secrets: options.secretStore,
      emit: (list) => live.server?.broadcast('connections.changed', { connections: list }),
      openBrowser: options.openBrowser,
      transportFor: options.connectorTransport,
      env: options.env ?? process.env,
    });
    void connections.start();
    const approvals = new Approvals((params) =>
      live.server?.broadcast('connector.confirm', params),
    );
    const runner = new ConversationRunner({
      store,
      settings,
      provider: resolve,
      emit,
      memory,
      // The Now facts on each question: time, last talk, and which experts are on what.
      // Known gap: a routine's turn counts as the last talk.
      now: {
        clock: () => new Date(),
        timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
        lastTalkAt: (petId) => activity.lastTurnAt(petId),
        running: () => handoffs.running(),
        waiting: () => handoffs.pending(),
        finishedSince: (since) => [
          ...activity.expertsFinishedSince(since).map((done) => ({
            expertName: done.expertName,
            ask: done.text,
            state: 'done' as const,
          })),
          ...activity.expertsLeftSince(since),
        ],
      },
      // Off the request path: the reply is already on screen when the summary starts.
      afterTurn: ({ pet, conversationId }) => void summarizer.schedule(conversationId, pet),
      watch: { manager: watches, hosts },
      // Read per turn: experts are added and switched off while the app runs.
      experts: {
        experts: () => experts.list(),
        propose: (params) => handoffs.propose(params),
        // Only reached on a routine's turn, for the expert its saved card allowed.
        startReadOnly: (params) => handoffs.startReadOnly(params),
        // tell_expert: the person's words for an expert already working.
        running: () => handoffs.running(),
        steer: (handoffId, text) => handoffs.steer(handoffId, text),
      },
      routines: {
        list: () => live.routines?.list() ?? [],
        experts: () => experts.list(),
        propose: (params) => routinesOf(live).propose(params),
      },
      // Change settings by talking: the card only. The host saves it on Apply (settings.set).
      changeSettings: {
        get: () => settings.get(),
        // The desktop only: the patch carries the current voice, hotkeys and exclusions,
        // and only the desktop bubble can apply a card.
        emit: (params) => {
          for (const session of live.server?.sessions() ?? []) {
            if (session.host === 'desktop') session.notify('settings.proposed', params);
          }
        },
      },
      connections: {
        tools: () => connections.tools(),
        call: (id, name, args, signal) => connections.call(id, name, args, signal),
        confirm: (params, signal) => approvals.ask(params, signal),
        record: (entry) => activity.connectorCalled(entry),
      },
      // "What was that article I read Tuesday?" and "what did we do today?": the FTS index
      // and the records already kept, limited to the days the privacy log keeps. Nothing
      // new is tracked for it.
      history: {
        history: new HistorySearch(db, { days: () => settings.get().sightLog.days }),
        activity,
        sightLog,
        days: () => settings.get().sightLog.days,
      },
      // Both lookups are lazy: hosts connect and drop between turns, and the exclusion
      // list is edited while the app runs, so neither can be captured at boot.
      perception: {
        hosts,
        exclusions: () => settings.get().captureExclusions,
        // Lazy for the same reason: the cap is a cost control the user edits in Settings,
        // and reading it at boot would make saving it do nothing until the next launch.
        windowTextBudget: () => settings.get().windowTextBudget,
        // Whether a look returns pixels depends on the pet asking, so the runner passes
        // `vision` with every tool call.
      },
    });

    // Meeting prep's calendar: the .ics link from the keychain, fetched every 15 min at most.
    const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
    const calendar = new CalendarFeed({
      secrets: options.secretStore,
      fetchText: options.calendarFetch ?? httpsFetchText(),
      clock: systemWatchClock,
      timeZone,
    });
    // Routines run as Scout turns in the background, on the system clock and time zone.
    const routines = new Routines({
      store: routineStore,
      clock: systemWatchClock,
      timeZone,
      pet: () => pets.get(SCOUT_ID),
      experts: () => experts.list(),
      exclusions: () => settings.get().captureExclusions,
      run: (ask) => {
        const handle = runner.run({
          pet: ask.pet,
          text: ask.text,
          background: true,
          routine: {
            routineId: ask.routineId,
            name: ask.name,
            expertId: ask.preApprovedExpertId,
            instruction: ask.instruction,
            handedOff: ask.handedOff,
          },
        });
        return {
          conversationId: handle.conversationId,
          done: handle.done.then((outcome) => ({ text: outcome.text, error: outcome.error })),
        };
      },
      answer: (conversationId, text) =>
        store.appendMessage({
          conversationId,
          role: 'assistant',
          content: [{ type: 'text', text }],
        }),
      activity,
      windows: listHostWindows,
      emit: (event) => live.server?.broadcast(event.method, event.params),
      log: (message) => console.warn(`[engine] ${message}`),
      meetings: calendar,
      spentOut,
    });
    live.routines = routines;

    // Pick up where you left off: one snapshot every ten minutes, offered once when you are back.
    const pickUp = new PickUp({
      store: pickUpStore,
      clock: systemWatchClock,
      enabled: () => settings.get().pickUp,
      windows: listHostWindows,
      exclusions: () => settings.get().captureExclusions,
      suggest: (title) => projects.suggest(title),
      readBranch,
      pending: () => handoffs.pending(),
      stoppedSince: (since) => activity.expertsLeftSince(since),
      propose: ({ expertId, ask }) =>
        void handoffs.propose({ expertId, petId: SCOUT_ID, brief: { ask } }),
      emit: (params) => live.server?.broadcast('pickUp.ready', params),
      log: (message) => console.warn(`[engine] ${message}`),
    });

    const handlers = buildHandlers({
      activity,
      runner,
      pets,
      settings,
      hosts,
      watches,
      experts,
      handoffs,
      projects,
      connectorFor,
      resolve,
      keepAnEye,
      wellbeing,
      connections,
      approvals,
      interruptedAtBoot,
      routines,
      pickUp,
      calendar,
      hostKinds: () => live.server?.sessions().map((session) => session.host) ?? [],
      claudeCodeConfigPath: options.claudeCodeConfigPath,
      claudePluginsRoot: options.claudePluginsRoot,
      claudeSpawn: options.claudeSpawn,
      fake: (options.env ?? process.env).TAGALONG_FAKE_PROVIDERS === '1',
      sightLog,
      checkResolve: guarded,
      refreshProviders: async () => keyed?.refresh(),
      models: (providerId) =>
        listModels(providerId, options.secretStore, settings, options.env ?? process.env),
    });
    // Home's Spend card.
    handlers['usage.summary'] = () => ({
      ...usage.summary(),
      todayUsd: usage.todayUsd(),
      budget: { dailyUsd: settings.get().budget.dailyUsd, spentOut: spentOut() },
    });

    const server = await EngineServer.start({
      port: options.port ?? current.enginePort ?? DEFAULT_ENGINE_PORT,
      token: readOrCreatePairingToken(options.dataDir),
      engineVersion: options.engineVersion,
      listPets: () => pets.list(),
      handlers,
    });

    live.server = server;
    routines.start();
    pickUp.start();

    return new Engine({
      db,
      server,
      runner,
      token: readOrCreatePairingToken(options.dataDir),
      watches,
      handoffs,
      connections,
      routines,
      pickUp,
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

  async shutdown(): Promise<void> {
    this.#routines.stop();
    this.#pickUp.stop();
    this.#watches.stopAll();
    await this.#handoffs.stopAll();
    await this.#connections.closeAll();
    await this.#runner.stopAll();
    await this.#server.close();
    this.#db.close();
  }
}

function buildHandlers(parts: {
  activity: ActivityLog;
  runner: ConversationRunner;
  pets: PetRegistry;
  settings: SettingsStore;
  /** Lazy, like the toolset's: the extension connects and drops while the app runs. */
  hosts: () => readonly PerceptionHost[];
  watches: WatchManager;
  experts: ExpertStore;
  handoffs: HandoffManager;
  projects: ProjectFinder;
  connectorFor: (expert: Expert) => Connector;
  routines: Routines;
  pickUp: PickUp;
  calendar: CalendarFeed;
  /** The guarded resolver turns use, for the one-off greeting call. */
  resolve: ProviderResolver;
  models: (providerId: string) => Promise<{ models: string[]; source: 'live' | 'fallback' }>;
  keepAnEye: KeepAnEye;
  wellbeing: Wellbeing;
  connections: ConnectionManager;
  approvals: Approvals;
  /** Runs boot found still running and closed as interrupted. */
  interruptedAtBoot: number;
  /** Which hosts are connected now, for the health check's browser row. */
  hostKinds: () => readonly HostKind[];
  claudeCodeConfigPath: string | undefined;
  claudePluginsRoot: string | undefined;
  claudeSpawn: SpawnFn | undefined;
  /** Fake mode: the catalog's Install starts no real claude. */
  fake: boolean;
  /** Re-reads provider keys, so a key saved since the last ask is used by this one. */
  refreshProviders: () => Promise<void>;
  sightLog: SightLog;
  /** Guarded but not recorded: a key check sends no screen, so it writes no row. */
  checkResolve: ProviderResolver;
}): MethodHandlers {
  const { activity, runner, pets, settings, models, hosts, watches } = parts;
  const { refreshProviders, experts, handoffs, projects, connectorFor, resolve } = parts;
  const { keepAnEye, connections, approvals, routines, interruptedAtBoot, pickUp } = parts;
  const { sightLog, checkResolve } = parts;
  const { calendar } = parts;
  const { hostKinds } = parts;
  const { wellbeing } = parts;
  /** A manager refusal (an id taken, none such) as an invalidParams error the host shows. */
  const plainly = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      throw new RpcFailure(RPC_ERROR_CODES.invalidParams, (error as Error).message);
    }
  };

  return {
    ask: async (params) => {
      const pet = pets.get(params.petId);
      if (pet === null) throw new Error(`no pet with id '${params.petId}'`);
      await refreshProviders();
      // The hotkey's own read, taken by the host before the ask: the one look no host
      // method sees. Logged before the browser fills it in, which logs its own read.
      recordSnapshot(sightLog, params.snapshot);
      // A desktop hotkey pressed in a browser gets the extension's exact selection and the
      // page text, when the extension answers within half a second.
      const snapshot = await browserContextFor(params.snapshot, {
        hosts: hosts(),
        exclusions: settings.get().captureExclusions,
      });
      // Talk to Scout transcribes in the host; an ask arrives as text.
      const handle = runner.run({
        pet,
        text: params.input.text ?? '',
        conversationId: params.conversationId,
        snapshot,
        spoken: params.spoken,
      });
      // The turn keeps running after this resolves; progress arrives as notifications.
      return { turnId: handle.turnId };
    },

    interrupt: (params) => ({ aborted: runner.interrupt(params.turnId) }),

    'pets.list': () => ({ pets: pets.list() }),
    'pets.upsert': (params) => ({ pet: pets.upsert(checkedPet(params.pet)) }),

    'settings.get': () => ({ settings: settings.get() }),
    'settings.set': (params) => {
      const next = settings.set(params.patch);
      // Applied from Scout's settings card: the privacy log names which settings, never values.
      if (params.byTalk === true) {
        sightLog.record({
          kind: 'changed_by_talk',
          title: Object.keys(params.patch).sort().join(', '),
        });
      }
      // Switching pick-up off deletes the snapshot it kept.
      if (!next.pickUp) pickUp.clear();
      // Nudges switched off: a tired face clears now, as no more ticks will come.
      if (!next.wellbeing.enabled) wellbeing.settle();
      return { settings: next };
    },
    'models.list': (params) => models(params.providerId),
    // Setup's one test of a pasted key, on Scout as it would think with that provider.
    'providers.check': async (params) => {
      await refreshProviders();
      const base = pets.get(SCOUT_ID);
      if (base === null) {
        throw new RpcFailure(RPC_ERROR_CODES.invalidParams, 'there is no Scout to test a key with');
      }
      const label =
        openAiPreset(params.providerId)?.label ??
        (params.providerId === 'anthropic' ? 'Anthropic' : params.providerId);
      return checkKey({ resolve: checkResolve, base, providerId: params.providerId, label });
    },
    'watch.stop': (params) => ({ stopped: watches.stop(params.watchId) }),

    'activity.list': (params) => activity.list(params),

    'experts.list': () => ({ experts: experts.list() }),
    'experts.upsert': (params) => {
      if (
        params.expert.catalogId !== undefined &&
        catalogEntry(params.expert.catalogId) === undefined
      ) {
        throw new RpcFailure(
          RPC_ERROR_CODES.invalidParams,
          `'${params.expert.catalogId}' is not in the expert catalog`,
        );
      }
      return { expert: experts.upsert(fromCatalog(params.expert)) };
    },
    'experts.delete': (params) => {
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
    'handoffs.cancel': (params) => ({ cancelled: handoffs.cancel(params.handoffId) }),
    'handoffs.confirm': (params) => handoffs.confirm(params),
    'handoffs.dismiss': (params) => ({ dismissed: handoffs.dismiss(params.proposalId) }),
    'projects.search': (params) => ({ projects: projects.search(params.query) }),

    // The line said as the app opens. Reads no screen: the time, the time away, and the
    // hand-offs that finished since the last launch. Never fails: a fallback line stands in.
    'greeting.compose': async (params) => {
      const pet = pets.get(params.petId);
      if (pet === null) {
        throw new RpcFailure(RPC_ERROR_CODES.invalidParams, `no pet with id '${params.petId}'`);
      }
      await refreshProviders();
      const { summarizer, lastOpenedAt, lastClosedAt, userName } = settings.get();
      // Away since the last quit; a crash records no quit, so then since the last launch.
      const awaySince = [lastOpenedAt, lastClosedAt]
        .filter((at): at is string => at !== null)
        .map((at) => new Date(at))
        .reduce<Date | null>((latest, at) => (latest === null || at > latest ? at : latest), null);
      const now = new Date();
      const scenario =
        params.launch === undefined
          ? undefined
          : launchScenario({
              crashed: params.launch.crashed,
              lastVersion: params.launch.lastVersion,
              version: params.launch.version,
              now,
              awaySince,
              pickUpReady: pickUp.ready() !== null,
            });
      // A pick-up is handwritten from what was open, with no model call, so it never
      // invents a file. It is taken here, once.
      const offered = scenario === 'pickUp' ? pickUp.take() : null;
      if (offered !== null) return { text: offered.text, source: 'fallback', pickUp: offered };
      return composeGreeting({
        pet,
        summarizer,
        provider: resolve,
        context: {
          now,
          awaySince,
          handoffs: lastOpenedAt === null ? [] : activity.expertsFinishedSince(lastOpenedAt),
          routines: lastOpenedAt === null ? [] : activity.routinesFinishedSince(lastOpenedAt),
          userName,
          interrupted: interruptedAtBoot,
          ...(scenario === undefined ? {} : { scenario }),
          ...(scenario === 'update' && params.launch !== undefined
            ? { update: { version: params.launch.version, whatsNew: params.launch.whatsNew } }
            : {}),
        },
      });
    },
    // Answers at once: the look, when there is one, runs off the request path and ends
    // in a pet.remark notification or, most of the time, in nothing.
    'keepAnEye.observe': (params) => {
      void keepAnEye.observe(params.windows);
      return {};
    },
    // A nudge is a remark too, so the same Not now and offer buttons serve both.
    'keepAnEye.notNow': () => {
      wellbeing.notNow();
      return { quietUntil: keepAnEye.notNow().toISOString() };
    },
    'keepAnEye.accept': async (params) => ({
      proposed: (await keepAnEye.accept(params.remarkId)) || wellbeing.accept(params.remarkId),
    }),
    'wellbeing.observe': (params) => {
      wellbeing.observe(params);
      return {};
    },

    // Found on this PC: Claude Code's servers, read-only, minus those already added here.
    'connections.list': () => {
      const list = connections.list();
      const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
      const found = readClaudeCodeConnectors(parts.claudeCodeConfigPath).filter(
        (entry) =>
          !list.some(
            (c) =>
              same(c.name, entry.name) ||
              (c.transport.type === 'http' &&
                entry.transport.type === 'http' &&
                same(c.transport.url, entry.transport.url)),
          ),
      );
      return { connections: list, popular: [...POPULAR_CONNECTORS], found };
    },
    // Connect means sign in: a new OAuth app opens its sign-in straight away.
    'connections.add': (params) =>
      plainly(async () => {
        const added = await connections.add(params);
        const signIn = added.auth === 'oauth' && added.status === 'needs-sign-in';
        return { connection: signIn ? connections.beginSignIn(added.id) : added };
      }),
    'connections.setEnabled': (params) =>
      plainly(async () => ({
        connection: await connections.setEnabled(params.id, params.enabled),
      })),
    'connections.signIn': (params) =>
      plainly(async () => ({ connection: connections.beginSignIn(params.id) })),
    'connections.remove': async (params) => ({ removed: await connections.remove(params.id) }),
    'tool.approve': (params) => ({
      accepted: approvals.answer(params.approvalId, params.decision),
    }),

    // Routines. Saving one in Home, or pressing Save on Scout's card, is the person's consent.
    'routines.list': () => ({ routines: routines.list() }),
    'routines.save': (params) =>
      plainly(() => Promise.resolve({ routine: routines.save(params.routine) })),
    'routines.delete': (params) => ({ deleted: routines.delete(params.id) }),
    'routines.setEnabled': (params) => {
      const routine = routines.setEnabled(params.id, params.enabled);
      if (routine === null) {
        throw new RpcFailure(RPC_ERROR_CODES.invalidParams, `no routine '${params.id}'`);
      }
      return { routine };
    },
    // Answers at once; the result arrives as routine.result.
    'routines.runNow': (params) => {
      if (routines.get(params.id) === null) return { started: false };
      void routines.runNow(params.id);
      return { started: true };
    },
    'routines.confirm': (params) => routines.confirm(params),
    'routines.dismiss': (params) => ({ dismissed: routines.dismiss(params.proposalId) }),
    // Pick up: Brief again proposes the saved ask (nothing starts); Not now drops the offer.
    'pickUp.rebrief': (params) =>
      plainly(() => Promise.resolve({ proposed: pickUp.rebrief(params.itemId) })),
    'pickUp.dismiss': () => ({ dismissed: pickUp.dismiss() }),

    // What Scout saw. Deleting removes the record, not what was already sent.
    'sightLog.list': (params) => ({ entries: sightLog.list(params.limit) }),
    'sightLog.delete': (params) => ({ deleted: sightLog.delete(params.id) }),
    'experts.catalog': () => {
      const have = {
        plugins: installedPlugins(parts.claudePluginsRoot),
        apps: connectedApps(parts.claudeCodeConfigPath),
      };
      return { entries: CATALOG.map((entry) => catalogStatus(entry, have)) };
    },
    // Runs only on the person's Install press, after the card named each plugin it adds.
    'experts.install': async (params) => {
      const entry = catalogEntry(params.catalogId);
      if (entry === undefined) {
        throw new RpcFailure(
          RPC_ERROR_CODES.invalidParams,
          `'${params.catalogId}' is not in the expert catalog`,
        );
      }
      // Fake mode never starts a real claude, the rule every connector follows.
      if (parts.fake) return { ok: true, installed: [] };
      return installMissing(
        entry.plugins.map((plugin) => plugin.id),
        installedPlugins(parts.claudePluginsRoot),
        (id) => installPlugin(id, parts.claudeSpawn ? { spawn: parts.claudeSpawn } : {}),
      );
    },
    'sightLog.clear': () => ({ deleted: sightLog.clear() }),
    // Meeting prep's link goes to the keychain, never to settings; the answer never holds it.
    'calendar.setLink': async (params) => {
      await calendar.setLink(params.link);
      return calendar.check();
    },
    'calendar.check': () => calendar.check(),

    // The health check's browser row. Not in EXTENSION_METHODS, so only the desktop asks.
    'hosts.status': () => ({ extension: hostKinds().includes('extension') }),
  };
}
