/**
 * An in-memory HostBridge for tests, with `emit` to push brain events and arrays that
 * record what the components asked for. Contains createFakeHostBridge and FakeHostBridge.
 */

import type {
  AppAddParams,
  AppInfo,
  ContextSnapshot,
  PerceptionTarget,
  Pet,
  MemoryEntry,
} from '@tagalong/protocol';
import type {
  ApprovalCounts,
  ApprovalRow,
  AskInput,
  BrainLink,
  HostBridge,
  JobRow,
  PermissionRow,
  PreferenceRow,
  TurnEvent,
} from '../host-bridge';

export interface FakeHostBridge extends HostBridge {
  /** Delivers an event to every subscriber synchronously, so tests need no timers. */
  emit(event: TurnEvent): void;
  /** Tells every `onBrainChanged` subscriber that the brain changed `what`. */
  emitChanged(what: string): void;
  readonly asks: readonly AskInput[];
  readonly interrupts: readonly string[];
  /** The targets of every capture() call, in order. */
  readonly captures: readonly (readonly PerceptionTarget[])[];
  /** What the next capture() resolves to; null stands in for a blocked window. */
  nextCapture: ContextSnapshot | null;
  /** What Scout remembers, newest first; delete edits it. */
  memories: MemoryEntry[];
  /** Home's Permissions rows; setPermission edits them, a test may swap them. */
  permissions: PermissionRow[];
  /** Every setPermission call, in order. */
  readonly permissionSets: readonly { tool: string; mode: 'ask' | 'auto' }[];
  /** Home's Jobs rows; a test may swap them. */
  jobs: JobRow[];
  /** Every stopJob call's job id, in order. */
  readonly jobStops: readonly string[];
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
  /** Every text put on the clipboard with Copy, in order. */
  readonly copied: readonly string[];
}

/**
 * Shipped from the package rather than kept in test files: the extension's side-panel tests
 * use the same bridge double without booting a brain.
 */
export function createFakeHostBridge(
  options: {
    pets?: Pet[];
    capture?: ContextSnapshot | null;
    /** The brain's apps to start with. */
    apps?: AppInfo[];
    /** Listing apps rejects with this message, as "brain offline" does. */
    listFails?: string;
    /** What Scout remembers, newest first. */
    memories?: MemoryEntry[];
    /** Home's Permissions rows. */
    permissions?: PermissionRow[];
    /** Home's Jobs rows. */
    jobs?: JobRow[];
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
  const captures: (readonly PerceptionTarget[])[] = [];
  let turnCount = 0;
  const approvals: { approvalId: string; decision: 'once' | 'always' | 'deny' }[] = [];
  const jobAnswers: { approvalId: string; option: string; text?: string }[] = [];
  const addedConnections: AppAddParams[] = [];
  const enabledCalls: { id: string; enabled: boolean }[] = [];
  const restarts: string[] = [];
  const signIns: string[] = [];
  const removedConnections: string[] = [];
  const copied: string[] = [];
  const permissionSets: { tool: string; mode: 'ask' | 'auto' }[] = [];
  const jobStops: string[] = [];

  const fake: FakeHostBridge = {
    asks,
    interrupts,
    captures,
    nextCapture: options.capture ?? null,
    ask(input) {
      asks.push(input);
      turnCount += 1;
      return Promise.resolve({ turnId: `turn-${turnCount}` });
    },
    capture(targets) {
      captures.push(targets);
      // Read off the object so a test can change the answer between captures.
      return Promise.resolve(fake.nextCapture);
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
    copied,
    copyText(text) {
      copied.push(text);
      return Promise.resolve();
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
