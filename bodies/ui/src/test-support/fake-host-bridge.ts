/**
 * An in-memory HostBridge for tests, with `emit` to push brain events and arrays that
 * record what the components asked for. Contains createFakeHostBridge and FakeHostBridge.
 */

import type {
  AppAddParams,
  AppInfo,
  Pet,
  MemoryEntry,
  SetupOverview,
  SetupResult,
  TurnEvent,
} from '../shapes';
import type {
  ApprovalCounts,
  ApprovalRow,
  AskInput,
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
  readonly walkthroughOpens: readonly (number | undefined)[];
  /** Every setPermission call, in order. */
  readonly permissionSets: readonly { tool: string; mode: 'ask' | 'auto' }[];
  /** Home's Jobs rows; a test may swap them. */
  jobs: JobRow[];
  /** Every stopJob call's job id, in order. */
  readonly jobStops: readonly string[];
  /** A job's steps by job id, and the bubble's running steps; a test may swap them. */
  activity: Record<string, JobActivityEntry[]>;
  /** Scout's watch list by job id; a test may swap them. */
  watch: Record<string, WatchItem[]>;
  running: RunningStep[];
  /** How many times runningSteps was called. */
  runningStepCalls: number;
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
  readonly jobAnswers: readonly { approvalId: string; option: string; text?: string }[];
  /** The brain's apps; a test edits them, then emits `connections.changed`. */
  apps: AppInfo[];
  readonly addedConnections: readonly AppAddParams[];
  readonly enabledCalls: readonly { id: string; enabled: boolean }[];
  readonly restarts: readonly string[];
  readonly signIns: readonly string[];
  readonly removedConnections: readonly string[];
  /** The brain's setup overview and every setupExpert / setupApp call, in order. */
  setup: SetupOverview;
  readonly setupCalls: readonly { kind: 'expert' | 'app'; id: string; approved: boolean }[];
}

/**
 * Shipped from the package rather than kept in test files: the extension's side-panel tests
 * use the same bridge double without booting a brain.
 */
export function createFakeHostBridge(
  options: {
    pets?: Pet[];
    /** The brain's apps to start with. */
    apps?: AppInfo[];
    /** What setupOverview answers; defaults to nothing set up and nothing to add. */
    setup?: Partial<SetupOverview>;
    /** What setupExpert and setupApp answer; defaults to `{}`, which is success. */
    setupResult?: SetupResult;
    /** Listing apps rejects with this message, as "brain offline" does. */
    listFails?: string;
    /** What Scout remembers, newest first. */
    memories?: MemoryEntry[];
    /** Home's Permissions rows. */
    permissions?: PermissionRow[];
    /** Home's Jobs rows. */
    jobs?: JobRow[];
    /** A job's steps by job id, and the running steps the bubble shows. */
    activity?: Record<string, JobActivityEntry[]>;
    watch?: Record<string, WatchItem[]>;
    reports?: Record<string, string | null>;
    runningSteps?: RunningStep[];
    /** Home's Approvals history and preferences. */
    approvalRows?: ApprovalRow[];
    preferences?: PreferenceRow[];
    /** The brain link; defaults to online at the default address. */
    brainLink?: BrainLink;
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
  const jobAnswers: { approvalId: string; option: string; text?: string }[] = [];
  const addedConnections: AppAddParams[] = [];
  const enabledCalls: { id: string; enabled: boolean }[] = [];
  const restarts: string[] = [];
  const signIns: string[] = [];
  const removedConnections: string[] = [];
  const setupCalls: { kind: 'expert' | 'app'; id: string; approved: boolean }[] = [];
  const permissionSets: { tool: string; mode: 'ask' | 'auto' }[] = [];
  const jobStops: string[] = [];
  const activityCalls: [string, number][] = [];
  const reportCalls: [string, string][] = [];
  const keysSet: string[] = [];
  const limitsSet: number[] = [];
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
      stale: false,
      progress: null,
      failed: null,
      ...options.setup,
    },
    setupCalls,
    setupOverview() {
      if (options.listFails !== undefined) return Promise.reject(new Error(options.listFails));
      return Promise.resolve(structuredClone(fake.setup));
    },
    setupExpert(id, approved) {
      setupCalls.push({ kind: 'expert', id, approved });
      return Promise.resolve(options.setupResult ?? {});
    },
    setupApp(id, approved) {
      setupCalls.push({ kind: 'app', id, approved });
      return Promise.resolve(options.setupResult ?? {});
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
    usageSummary() {
      return Promise.resolve({ spentUsd: 0, limitUsd: null });
    },
    key: { hasKey: true, source: 'file', envPath: 'C:/tagalong/.env', dailyLimitUsd: 5 },
    keyResult: 'ok',
    keysSet,
    limitsSet,
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
        options.brainLink ?? { addr: 'ws://127.0.0.1:47321', status: 'online' },
      );
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
        started_at: fake.jobs.find((j) => j.id === job)?.startedAt ?? '',
        ended_at: null,
        closed_at: null,
        result: null,
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
