/**
 * An in-memory HostBridge for tests, with `emit` to push brain events and arrays that
 * record what the components asked for. Contains createFakeHostBridge and FakeHostBridge.
 */

import type {
  AppAddParams,
  AppInfo,
  BodiesState,
  LoopsState,
  TimerRow,
  Pet,
  MemoryEntry,
  ModelState,
  SetupOverview,
  SetupResult,
  TurnEvent,
  WhatsAppChange,
} from '../shapes';
import type {
  ApprovalCounts,
  ApprovalRow,
  AskInput,
  BrainCard,
  BrainLink,
  HostBridge,
  JobActivityEntry,
  JobActivityPage,
  JobRow,
  RunningStep,
  WatchItem,
  PermissionRow,
  PreferenceRow,
  KeyResult,
  KeyStatus,
} from '../host-bridge';

export interface FakeHostBridge extends HostBridge {
  /** Delivers an event to every subscriber synchronously, so tests need no timers. */
  emit(event: TurnEvent): void;
  /** Tells every `onBrainChanged` subscriber that the brain changed `what`. */
  emitChanged(what: string): void;
  readonly asks: readonly AskInput[];
  readonly interrupts: readonly string[];
  /** What Scout remembers, newest first; delete edits it. */
  memories: MemoryEntry[];
  /** Home's Permissions rows; setPermission edits them, a test may swap them. */
  permissions: PermissionRow[];
  /** The brain's key facts, and how the next key check ends; a test swaps either. */
  key: KeyStatus | 'offline';
  keyResult: KeyResult;
  /** Every key handed to setKey, every limit and every walkthrough step opened, in order. */
  readonly keysSet: readonly string[];
  readonly limitsSet: readonly number[];
  /** Scout's model as the brain reports it, every model handed to setModel, and a refusal to send. */
  model: ModelState;
  readonly modelsSet: readonly string[];
  modelError: string | null;
  readonly walkthroughOpens: readonly (number | undefined)[];
  /** Every setPermission call, in order. */
  readonly permissionSets: readonly { tool: string; mode: 'off' | 'ask' | 'auto' }[];
  /** Home's loops state; the loops calls edit it, a test may swap it. */
  loops: LoopsState;
  /** Every loops call made, in order: `set gmail on`, `forget id`, `wipe`. */
  readonly loopCalls: readonly string[];
  /** Home's timers; cancelTimer edits it, a test may swap it. */
  timers: TimerRow[];
  /** The id of every cancelTimer call, in order. */
  readonly cancelledTimers: readonly string[];
  /** Home's Bodies state; setWhatsApp edits it, a test may swap it. */
  bodies: BodiesState;
  /** Every WhatsApp change handed to setWhatsApp, in order. */
  readonly whatsappChanges: readonly WhatsAppChange[];
  /** When set, setWhatsApp rejects with this sentence. */
  whatsappFails?: string;
  /** The brain's reading_status answer (JSON text); a test may swap it. */
  reading: string;
  /** Every reading and ask call made, in order: `recheck`, `settings`, `ask <text>`. */
  readonly readingCalls: readonly string[];
  /** Home's Jobs rows; a test may swap them. */
  jobs: JobRow[];
  /** Every stopJob call's job id, in order. */
  readonly jobStops: readonly string[];
  /** How many times Retry was pressed on the brain setup line. */
  readonly setupRetries: () => number;
  /** The brain card's calls in order: `restart`, `restart-after-work`, `open-folder`, `open-log`, `copy-details`. */
  readonly brainActions: readonly string[];
  /** A job's steps by job id, and the bubble's running steps; a test may swap them. */
  activity: Record<string, JobActivityEntry[]>;
  /** Scout's watch list by job id; a test may swap them. */
  watch: Record<string, WatchItem[]>;
  running: RunningStep[];
  /** How many times runningSteps was called. */
  runningStepCalls: number;
  /** Scout's full result by job id, as a job's activity page carries it. */
  results: Record<string, string>;
  /** Part reports by `job/part`; a missing key is a part with no report. */
  reports: Record<string, string | null>;
  /** Every jobReport call as [job, part], in order. */
  readonly reportCalls: readonly (readonly [string, string])[];
  /** Every jobActivity call as [job, afterRev], in order. */
  readonly activityCalls: readonly (readonly [string, number])[];
  /** Home's Approvals history, newest first, and the preferences Scout follows; a test may swap them. */
  approvalRows: ApprovalRow[];
  preferences: PreferenceRow[];
  /** Every listApprovals call, every removePreference id and every editPreference call, in order. */
  readonly approvalListCalls: readonly { filter: 'all' | 'scout' | 'refused'; before?: number }[];
  readonly preferenceRemovals: readonly number[];
  readonly preferenceEdits: readonly { id: number; sentence: string }[];
  /** Tells every `onApproved` subscriber that Scout approved an ask under a preference. */
  emitApproved(n: { tool: string; text: string; preference: string; cameUp?: boolean }): void;
  /** Every answer to a connector confirm card, in order. */
  readonly approvals: readonly { approvalId: string; decision: 'once' | 'always' | 'deny' }[];
  /** Every answer to a Claude Code job's ask (its own option, or typed text), in order. */
  readonly jobAnswers: readonly {
    approvalId: string;
    option: string;
    text?: string;
    apps?: string[];
  }[];
  /** The brain's apps; a test edits them, then emits `connections.changed`. */
  apps: AppInfo[];
  readonly addedConnections: readonly AppAddParams[];
  readonly enabledCalls: readonly { id: string; enabled: boolean }[];
  readonly restarts: readonly string[];
  readonly signIns: readonly string[];
  readonly removedConnections: readonly string[];
  /** The brain's setup overview and every setupExpert / setupApp call, in order. */
  setup: SetupOverview;
  readonly setupCalls: readonly SetupCall[];
  /** Every setupOverview call: the search query and cursor it was given. */
  readonly setupOverviewCalls: readonly { query?: string; cursor?: string }[];
}

interface SetupCall {
  kind: 'expert' | 'app';
  id: string;
  approved: boolean;
  communityOk?: boolean;
}

const NO_BODIES: BodiesState = {
  bodies: [
    { kind: 'desktop', name: 'Desktop', connected: true },
    { kind: 'browser', name: 'Browser', connected: false },
    { kind: 'whatsapp', name: 'WhatsApp', connected: false },
  ],
  whatsapp: {
    enabled: false,
    set: {
      accessToken: false,
      appSecret: false,
      verifyToken: false,
      phoneNumberId: false,
      allowedNumber: false,
    },
    complete: false,
    state: 'off',
    port: 47322,
  },
};

/**
 * Shipped from the package rather than kept in test files: the extension's side-panel tests
 * use the same bridge double without booting a brain.
 */
export function createFakeHostBridge(
  options: {
    pets?: Pet[];
    /** Confirm cards the body still holds open when the bubble mounts (a relaunch). */
    openConfirms?: TurnEvent[];
    /** The brain's apps to start with. */
    apps?: AppInfo[];
    /** What setupOverview answers; defaults to nothing set up and nothing to add. */
    setup?: Partial<SetupOverview>;
    /** What setupExpert and setupApp answer; defaults to `{}`, which is success. */
    setupResult?: SetupResult | (() => Promise<SetupResult>);
    /** Makes only setupOverview fail (listFails fails the connections list too). */
    overviewFails?: string;
    /** Per-search answer: fields laid over `setup` for this query and cursor. */
    setupFor?: (query?: string, cursor?: string) => Partial<SetupOverview>;
    /** Listing apps rejects with this message, as "brain offline" does. */
    listFails?: string;
    /** What Scout remembers, newest first. */
    memories?: MemoryEntry[];
    /** Home's Permissions rows. */
    permissions?: PermissionRow[];
    /** Home's loops state. */
    loops?: LoopsState;
    /** Home's timers. */
    timers?: TimerRow[];
    /** Home's Bodies state. */
    bodies?: BodiesState;
    /** The brain's reading_status answer (JSON text). */
    reading?: string;
    /** Home's Jobs rows. */
    jobs?: JobRow[];
    /** A job's steps by job id, and the running steps the bubble shows. */
    activity?: Record<string, JobActivityEntry[]>;
    watch?: Record<string, WatchItem[]>;
    reports?: Record<string, string | null>;
    results?: Record<string, string>;
    runningSteps?: RunningStep[];
    /** Home's Approvals history and preferences. */
    approvalRows?: ApprovalRow[];
    preferences?: PreferenceRow[];
    /** The brain link; defaults to online at the default address. */
    brainLink?: BrainLink;
    /** Scout's brain card; defaults to a running brain the desktop started, up to date. */
    brainCard?: BrainCard;
  } = {},
): FakeHostBridge {
  const handlers = new Set<(event: TurnEvent) => void>();
  const changedHandlers = new Set<(what: string) => void>();
  const approvedHandlers = new Set<
    (n: { tool: string; text: string; preference: string; cameUp?: boolean }) => void
  >();
  const approvalListCalls: { filter: 'all' | 'scout' | 'refused'; before?: number }[] = [];
  const preferenceRemovals: number[] = [];
  const preferenceEdits: { id: number; sentence: string }[] = [];
  const asks: AskInput[] = [];
  const interrupts: string[] = [];
  let turnCount = 0;
  const approvals: { approvalId: string; decision: 'once' | 'always' | 'deny' }[] = [];
  const jobAnswers: { approvalId: string; option: string; text?: string; apps?: string[] }[] = [];
  const addedConnections: AppAddParams[] = [];
  const enabledCalls: { id: string; enabled: boolean }[] = [];
  const restarts: string[] = [];
  const signIns: string[] = [];
  const removedConnections: string[] = [];
  const setupCalls: SetupCall[] = [];
  const setupOverviewCalls: { query?: string; cursor?: string }[] = [];
  const permissionSets: { tool: string; mode: 'off' | 'ask' | 'auto' }[] = [];
  const cancelledTimers: string[] = [];
  const loopCalls: string[] = [];
  const whatsappChanges: WhatsAppChange[] = [];
  const readingCalls: string[] = [];
  const jobStops: string[] = [];
  let setupRetries = 0;
  const brainActions: string[] = [];
  const activityCalls: [string, number][] = [];
  const reportCalls: [string, string][] = [];
  const keysSet: string[] = [];
  const limitsSet: number[] = [];
  const modelsSet: string[] = [];
  const walkthroughOpens: (number | undefined)[] = [];

  const fake: FakeHostBridge = {
    asks,
    interrupts,
    ask(input) {
      asks.push(input);
      turnCount += 1;
      return Promise.resolve({ turnId: `turn-${turnCount}` });
    },
    interrupt(turnId) {
      interrupts.push(turnId);
      return Promise.resolve();
    },
    onTurnEvent(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    openConfirms() {
      return Promise.resolve([...(options.openConfirms ?? [])]);
    },
    listPets() {
      return Promise.resolve(options.pets ?? []);
    },
    approvals,
    approveTool(approvalId, decision) {
      approvals.push({ approvalId, decision });
      return Promise.resolve();
    },
    jobAnswers,
    answerJobAsk(approvalId, answer) {
      jobAnswers.push({ approvalId, ...answer });
      return Promise.resolve();
    },
    apps: [...(options.apps ?? [])],
    addedConnections,
    enabledCalls,
    restarts,
    signIns,
    removedConnections,
    setup: {
      experts: [],
      apps: [],
      browseExperts: [],
      browseApps: [],
      popular: [],
      appGroups: [],
      nextCursor: null,
      sources: null,
      stale: false,
      progress: null,
      failed: null,
      ...options.setup,
    },
    setupCalls,
    setupOverviewCalls,
    setupOverview(query, cursor) {
      setupOverviewCalls.push({
        ...(query === undefined ? {} : { query }),
        ...(cursor === undefined ? {} : { cursor }),
      });
      const failure = options.overviewFails ?? options.listFails;
      if (failure !== undefined) return Promise.reject(new Error(failure));
      return Promise.resolve(
        structuredClone({ ...fake.setup, ...options.setupFor?.(query, cursor) }),
      );
    },
    setupExpert(id, approved, communityOk) {
      setupCalls.push({ kind: 'expert', id, approved, ...(communityOk ? { communityOk } : {}) });
      return typeof options.setupResult === 'function'
        ? options.setupResult()
        : Promise.resolve(options.setupResult ?? {});
    },
    setupApp(id, approved, _query, communityOk) {
      setupCalls.push({ kind: 'app', id, approved, ...(communityOk ? { communityOk } : {}) });
      return typeof options.setupResult === 'function'
        ? options.setupResult()
        : Promise.resolve(options.setupResult ?? {});
    },
    listConnections() {
      if (options.listFails !== undefined) return Promise.reject(new Error(options.listFails));
      return Promise.resolve({ apps: structuredClone(fake.apps) });
    },
    addConnection(params) {
      addedConnections.push(params);
      const id = params.name.toLowerCase();
      fake.apps.push({
        id,
        name: params.name,
        transport: params.transport,
        auth: params.auth ?? 'none',
        enabled: true,
        status: params.auth === 'oauth' ? 'needs-sign-in' : 'connected',
        error: '',
        tools: [],
      });
      return Promise.resolve({ id });
    },
    setConnectionEnabled(id, enabled) {
      enabledCalls.push({ id, enabled });
      fake.apps = fake.apps.map((a) =>
        a.id === id ? { ...a, enabled, status: enabled ? 'connected' : 'off' } : a,
      );
      return Promise.resolve({ id, enabled });
    },
    restartConnection(id) {
      restarts.push(id);
      return Promise.resolve({ id });
    },
    signInConnection(id) {
      signIns.push(id);
      // The brain answers at once; the browser outcome arrives later through `changed`.
      fake.apps = fake.apps.map((a) => (a.id === id ? { ...a, status: 'connecting' } : a));
      return Promise.resolve({ id, status: 'connecting' });
    },
    removeConnection(id) {
      removedConnections.push(id);
      fake.apps = fake.apps.filter((a) => a.id !== id);
      return Promise.resolve({ id, removed: true });
    },
    memories: [...(options.memories ?? [])],
    listMemories() {
      return Promise.resolve([...fake.memories]);
    },
    deleteMemory(id) {
      const before = fake.memories.length;
      fake.memories = fake.memories.filter((memory) => memory.id !== id);
      return Promise.resolve(fake.memories.length < before);
    },
    loops: options.loops ?? { apps: [], loops: [] },
    timers: options.timers ?? [],
    cancelledTimers,
    loopCalls,
    bodies: options.bodies ?? NO_BODIES,
    whatsappChanges,
    reading: options.reading ?? '{"rows":[]}',
    readingCalls,
    readingStatus() {
      return Promise.resolve(fake.reading);
    },
    readingRecheck() {
      readingCalls.push('recheck');
      return Promise.resolve();
    },
    openLanguageSettings() {
      readingCalls.push('settings');
      return Promise.resolve();
    },
    askScout(text) {
      readingCalls.push(`ask ${text}`);
      return Promise.resolve();
    },
    loopsState() {
      return Promise.resolve(structuredClone(fake.loops));
    },
    setLoopsOn(app, on) {
      loopCalls.push(`set ${app} ${on ? 'on' : 'off'}`);
      fake.loops = {
        ...fake.loops,
        apps: fake.loops.apps.map((a) => (a.id === app ? { ...a, on } : a)),
      };
      return Promise.resolve();
    },
    forgetLoop(id) {
      loopCalls.push(`forget ${id}`);
      fake.loops = { ...fake.loops, loops: fake.loops.loops.filter((l) => l.id !== id) };
      return Promise.resolve();
    },
    loopDone(id) {
      loopCalls.push(`done ${id}`);
      fake.loops = {
        ...fake.loops,
        loops: fake.loops.loops.map((l) => (l.id === id ? { ...l, status: 'done' } : l)),
      };
      return Promise.resolve();
    },
    loopLater(id, until) {
      loopCalls.push(`later ${id} ${until}`);
      fake.loops = {
        ...fake.loops,
        loops: fake.loops.loops.map((l) => (l.id === id ? { ...l, status: 'snoozed' } : l)),
      };
      return Promise.resolve();
    },
    wipeLoops() {
      loopCalls.push('wipe');
      fake.loops = { apps: fake.loops.apps.map((a) => ({ ...a, on: false })), loops: [] };
      return Promise.resolve();
    },
    timersState() {
      return Promise.resolve(structuredClone(fake.timers));
    },
    cancelTimer(id) {
      cancelledTimers.push(id);
      fake.timers = fake.timers.filter((t) => t.id !== id);
      return Promise.resolve();
    },
    bodiesState() {
      return Promise.resolve(structuredClone(fake.bodies));
    },
    setWhatsApp(change) {
      whatsappChanges.push(change);
      if (fake.whatsappFails !== undefined) return Promise.reject(new Error(fake.whatsappFails));
      const w = fake.bodies.whatsapp;
      const set = { ...w.set };
      for (const field of Object.keys(set) as (keyof typeof set)[]) {
        if (change[field] !== undefined) set[field] = true;
      }
      const complete = Object.values(set).every(Boolean);
      const enabled = change.enabled ?? w.enabled;
      fake.bodies = {
        ...fake.bodies,
        whatsapp: { ...w, set, complete, enabled, port: change.port ?? w.port },
      };
      return Promise.resolve();
    },
    permissions: (options.permissions ?? []).map((row) => ({ ...row })),
    permissionSets,
    listPermissions() {
      return Promise.resolve(fake.permissions.map((row) => ({ ...row })));
    },
    setPermission(tool, mode) {
      permissionSets.push({ tool, mode });
      fake.permissions = fake.permissions.map((row) =>
        row.name === tool ? { ...row, mode } : row,
      );
      return Promise.resolve();
    },
    jobs: (options.jobs ?? []).map((row) => ({ ...row })),
    jobStops,
    setupRetries: () => setupRetries,
    brainActions,
    usageSummary() {
      return Promise.resolve({ spentUsd: 0, limitUsd: null });
    },
    key: { hasKey: true, source: 'file', envPath: 'C:/tagalong/.env', dailyLimitUsd: 5 },
    keyResult: 'ok',
    keysSet,
    limitsSet,
    modelsSet,
    modelError: null,
    model: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      default: 'claude-opus-5-5',
      models: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', line: 'Most capable' },
        { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', line: 'Faster and cheaper' },
        { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', line: 'Fastest, for simple tasks' },
      ],
    },
    modelState() {
      return Promise.resolve({ ...fake.model });
    },
    setModel(model) {
      if (fake.modelError !== null) return Promise.reject(new Error(fake.modelError));
      modelsSet.push(model);
      fake.model = { ...fake.model, model };
      return Promise.resolve();
    },
    walkthroughOpens,
    keyStatus() {
      return fake.key === 'offline'
        ? Promise.reject(new Error('brain offline'))
        : Promise.resolve(fake.key);
    },
    setKey(key) {
      keysSet.push(key);
      return Promise.resolve(fake.keyResult);
    },
    setDailyLimit(usd) {
      limitsSet.push(usd);
      return Promise.resolve();
    },
    openWalkthrough(step) {
      walkthroughOpens.push(step);
      return Promise.resolve();
    },
    // A test that wants a health card replaces this; the default fails like a host that cannot say.
    checkHealth() {
      return Promise.reject(new Error('no health facts in this fake'));
    },
    openFix() {
      return Promise.resolve();
    },
    openLogs() {
      return Promise.resolve();
    },
    brainLink() {
      return Promise.resolve(
        options.brainLink ?? { addr: 'ws://127.0.0.1:47321', status: 'online', setup: 'idle' },
      );
    },
    retryBrainSetup() {
      setupRetries++;
      return Promise.resolve();
    },
    brainCard() {
      return Promise.resolve(
        options.brainCard ?? {
          status: 'running',
          update: 'none',
          version: '0.9.2',
          build: 'a1b2c3d',
          appVersion: '0.9.2',
          appBuild: 'a1b2c3d',
          startedAt: new Date(Date.now() - 25 * 60_000).toISOString(),
          startedBy: 'desktop',
          addr: '127.0.0.1:47321',
          pid: 4242,
          dataDir: 'C:\\Users\\you\\.tagalong',
          logPath: 'C:\\Users\\you\\.tagalong\\brain.log',
          places: [{ id: 'desktop', kind: 'desktop', name: 'Desktop' }],
          workRunning: false,
        },
      );
    },
    restartBrain() {
      brainActions.push('restart');
      return Promise.resolve();
    },
    restartBrainAfterWork() {
      brainActions.push('restart-after-work');
      return Promise.resolve();
    },
    openBrainFolder() {
      brainActions.push('open-folder');
      return Promise.resolve();
    },
    openBrainLog() {
      brainActions.push('open-log');
      return Promise.resolve();
    },
    copyBrainDetails() {
      brainActions.push('copy-details');
      return Promise.resolve();
    },
    listJobs() {
      return Promise.resolve(fake.jobs.map((row) => ({ ...row })));
    },
    stopJob(job) {
      jobStops.push(job);
      return Promise.resolve();
    },
    jobActivity(job, afterRev) {
      activityCalls.push([job, afterRev]);
      const all = fake.activity[job];
      if (!all) return Promise.reject(new Error(`no job ${job}`));
      const entries = all.filter((e) => e.rev > afterRev);
      const page: JobActivityPage = {
        job,
        state: 'running',
        title: null,
        startedAt: '2026-10-27T10:00:00Z',
        endedAt: null,
        closedAt: null,
        result: fake.results[job] ?? null,
        parts: [],
        rev: all.reduce((top, e) => Math.max(top, e.rev), 0),
        entries,
        more: false,
        watch: fake.watch[job] ?? null,
      };
      return Promise.resolve(page);
    },
    jobReport(job, part) {
      reportCalls.push([job, part]);
      return Promise.resolve(fake.reports[`${job}/${part}`] ?? null);
    },
    runningSteps() {
      fake.runningStepCalls += 1;
      return Promise.resolve(fake.running.map((step) => ({ ...step })));
    },
    activity: { ...options.activity },
    watch: { ...options.watch },
    reports: { ...options.reports },
    results: { ...options.results },
    reportCalls,
    running: (options.runningSteps ?? []).map((step) => ({ ...step })),
    runningStepCalls: 0,
    activityCalls,
    approvalRows: (options.approvalRows ?? []).map((row) => ({ ...row })),
    preferences: (options.preferences ?? []).map((row) => ({ ...row })),
    approvalListCalls,
    preferenceRemovals,
    preferenceEdits,
    listApprovals(filter, before) {
      approvalListCalls.push(before === undefined ? { filter } : { filter, before });
      const rows = fake.approvalRows;
      const counts: ApprovalCounts = {
        total: rows.length,
        scout: rows.filter((r) => r.decidedBy === 'scout').length,
        refused: rows.filter((r) => r.outcome === 'refused').length,
      };
      const shown = rows
        .filter((r) => before === undefined || r.id < before)
        .filter((r) =>
          filter === 'scout'
            ? r.decidedBy === 'scout'
            : filter === 'refused'
              ? r.outcome === 'refused'
              : true,
        );
      return Promise.resolve({ approvals: shown.map((r) => ({ ...r })), counts, next: null });
    },
    listPreferences() {
      return Promise.resolve(fake.preferences.map((row) => ({ ...row })));
    },
    removePreference(id) {
      preferenceRemovals.push(id);
      fake.preferences = fake.preferences.filter((row) => row.id !== id);
      return Promise.resolve();
    },
    editPreference(id, sentence) {
      preferenceEdits.push({ id, sentence });
      fake.preferences = fake.preferences.map((row) =>
        row.id === id ? { ...row, sentence } : row,
      );
      return Promise.resolve();
    },
    onApproved(handler) {
      approvedHandlers.add(handler);
      return () => {
        approvedHandlers.delete(handler);
      };
    },
    emitApproved(n) {
      for (const handler of [...approvedHandlers]) handler(n);
    },
    onBrainChanged(handler) {
      changedHandlers.add(handler);
      return () => {
        changedHandlers.delete(handler);
      };
    },
    emitChanged(what) {
      for (const handler of [...changedHandlers]) handler(what);
    },
    emit(event) {
      // Copied first so a handler that unsubscribes mid-emit cannot skip its neighbours.
      for (const handler of [...handlers]) {
        handler(event);
      }
    },
  };

  return fake;
}
