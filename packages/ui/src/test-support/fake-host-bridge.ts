import type {
  ActivityEntry,
  ConnectionState,
  ConnectionsAddParams,
  ConnectionsListResult,
  ContextSnapshot,
  Expert,
  PerceptionTarget,
  Pet,
  ProjectCandidate,
  RoutineDraftInput,
  RoutineProposedParams,
  RoutineView,
  SightLogEntry,
} from '@tagalong/protocol';
import type { AskInput, ConfirmHandoff, HostBridge, TurnEvent } from '../host-bridge';

export interface FakeHostBridge extends HostBridge {
  /** Delivers an event to every subscriber synchronously, so tests need no timers. */
  emit(event: TurnEvent): void;
  readonly asks: readonly AskInput[];
  readonly interrupts: readonly string[];
  /** Every watch id the panel asked to stop, in order. */
  readonly stoppedWatches: readonly string[];
  /** The targets of every capture() call, in order. */
  readonly captures: readonly (readonly PerceptionTarget[])[];
  /** What the next capture() resolves to; null stands in for a blocked window. */
  nextCapture: ContextSnapshot | null;
  /** Home's activity, newest first; a test pushes or edits entries, then emits an event. */
  activity: ActivityEntry[];
  /** What Scout saw, newest first; delete and clear edit it. */
  sightLog: SightLogEntry[];
  /** How many times the activity was listed. */
  activityReads: number;
  /** Home's experts, as saved; a test reads them back after a save. */
  experts: Expert[];
  /** Every expert id tested, in order. */
  readonly testedExperts: readonly string[];
  /** Every hand-off the person sent, dismissed or stopped, in order. */
  readonly confirmedHandoffs: readonly ConfirmHandoff[];
  readonly dismissedHandoffs: readonly string[];
  readonly cancelledHandoffs: readonly string[];
  /** Every answer to a connector confirm card, in order. */
  readonly approvals: readonly { approvalId: string; decision: 'once' | 'deny' }[];
  /** Home's connections; a test edits them, then emits `connections.changed`. */
  connections: ConnectionsListResult;
  readonly addedConnections: readonly ConnectionsAddParams[];
  readonly signIns: readonly string[];
  readonly removedConnections: readonly string[];
  /** Home's routines, as saved; a test reads them back after a save. */
  routines: RoutineView[];
  readonly ranRoutines: readonly string[];
  readonly confirmedRoutines: readonly { proposalId: string; routine?: RoutineDraftInput }[];
  readonly dismissedRoutines: readonly string[];
  readonly editedRoutines: readonly RoutineProposedParams[];
  /** Every text put on the clipboard with Copy, in order. */
  readonly copied: readonly string[];
}

/**
 * Shipped from the package rather than kept in test files: the desktop host needs the
 * same bridge double to test its renderer without booting an engine.
 */
export function createFakeHostBridge(
  options: {
    pets?: Pet[];
    capture?: ContextSnapshot | null;
    /** Home's activity, newest first. */
    activity?: ActivityEntry[];
    experts?: Expert[];
    /** What testing an expert answers; absent answers ready. */
    testExpert?: (expertId: string) => { ok: boolean; error?: string };
    /** What the folder picker answers; absent means the host has no picker. */
    pickFolder?: () => string | null;
    /** What a project search answers; absent answers nothing found. */
    searchProjects?: (query: string) => ProjectCandidate[];
    connections?: Partial<ConnectionsListResult>;
    /** What adding answers; absent answers a connected connection with no tools. */
    addConnection?: (params: ConnectionsAddParams) => ConnectionState;
    routines?: RoutineView[];
    /** What Scout saw, newest first. */
    sightLog?: SightLogEntry[];
  } = {},
): FakeHostBridge {
  const handlers = new Set<(event: TurnEvent) => void>();
  const asks: AskInput[] = [];
  const interrupts: string[] = [];
  const stoppedWatches: string[] = [];
  const captures: (readonly PerceptionTarget[])[] = [];
  let turnCount = 0;
  const testedExperts: string[] = [];
  const confirmedHandoffs: ConfirmHandoff[] = [];
  const dismissedHandoffs: string[] = [];
  const cancelledHandoffs: string[] = [];
  const approvals: { approvalId: string; decision: 'once' | 'deny' }[] = [];
  const addedConnections: ConnectionsAddParams[] = [];
  const signIns: string[] = [];
  const removedConnections: string[] = [];
  const ranRoutines: string[] = [];
  const confirmedRoutines: { proposalId: string; routine?: RoutineDraftInput }[] = [];
  const dismissedRoutines: string[] = [];
  const editedRoutines: RoutineProposedParams[] = [];
  const copied: string[] = [];
  let routineCount = 0;
  const toView = (draft: RoutineDraftInput & { id?: string }): RoutineView => {
    routineCount += 1;
    const existing = fake.routines.find((r) => r.id === draft.id);
    return {
      enabled: true,
      topics: '',
      deliver: { bubble: true, voice: false, notification: false },
      uses: [],
      ...existing,
      ...draft,
      id: draft.id ?? `30000000-0000-4000-8000-${String(routineCount).padStart(12, '0')}`,
      createdAt: existing?.createdAt ?? '2026-10-13T07:00:00.000Z',
    } as RoutineView;
  };
  const update = (id: string, patch: Partial<ConnectionState>): ConnectionState => {
    const list = fake.connections.connections;
    const index = list.findIndex((c) => c.id === id);
    const next = { ...list[index]!, ...patch };
    list[index] = next;
    return next;
  };

  const fake: FakeHostBridge = {
    asks,
    interrupts,
    stoppedWatches,
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
    stopWatch(watchId) {
      stoppedWatches.push(watchId);
      return Promise.resolve();
    },
    listPets() {
      return Promise.resolve(options.pets ?? []);
    },
    activity: [...(options.activity ?? [])],
    activityReads: 0,
    listActivity(params = {}) {
      fake.activityReads += 1;
      const limit = params.limit ?? 30;
      const start =
        params.before === undefined
          ? 0
          : fake.activity.findIndex((entry) => entry.id === params.before) + 1;
      const entries = fake.activity.slice(start, start + limit);
      const last = entries.at(-1);
      const more = start + limit < fake.activity.length && last !== undefined;
      return Promise.resolve(more ? { entries, next: last.id } : { entries });
    },
    experts: [...(options.experts ?? [])],
    testedExperts,
    listExperts() {
      return Promise.resolve([...fake.experts]);
    },
    saveExpert(expert) {
      const index = fake.experts.findIndex((e) => e.id === expert.id);
      if (index === -1) fake.experts.push(expert);
      else fake.experts[index] = expert;
      return Promise.resolve(expert);
    },
    deleteExpert(expertId) {
      const before = fake.experts.length;
      fake.experts = fake.experts.filter((e) => e.id !== expertId);
      return Promise.resolve(fake.experts.length < before);
    },
    testExpert(expertId) {
      testedExperts.push(expertId);
      return Promise.resolve(options.testExpert?.(expertId) ?? { ok: true });
    },
    ...(options.pickFolder === undefined
      ? {}
      : { pickFolder: () => Promise.resolve(options.pickFolder?.() ?? null) }),
    confirmedHandoffs,
    dismissedHandoffs,
    cancelledHandoffs,
    confirmHandoff(params) {
      confirmedHandoffs.push(params);
      return Promise.resolve({ handoffId: `handoff-${confirmedHandoffs.length}` });
    },
    dismissHandoff(proposalId) {
      dismissedHandoffs.push(proposalId);
      return Promise.resolve();
    },
    cancelHandoff(handoffId) {
      cancelledHandoffs.push(handoffId);
      return Promise.resolve();
    },
    searchProjects(query) {
      return Promise.resolve(options.searchProjects?.(query) ?? []);
    },
    approvals,
    approveTool(approvalId, decision) {
      approvals.push({ approvalId, decision });
      return Promise.resolve();
    },
    connections: {
      connections: [...(options.connections?.connections ?? [])],
      popular: [...(options.connections?.popular ?? [])],
      found: [...(options.connections?.found ?? [])],
    },
    addedConnections,
    signIns,
    removedConnections,
    listConnections() {
      return Promise.resolve(structuredClone(fake.connections));
    },
    addConnection(params) {
      addedConnections.push(params);
      const added: ConnectionState = options.addConnection?.(params) ?? {
        id: params.id ?? params.name.toLowerCase(),
        name: params.name,
        transport:
          params.transport.type === 'http'
            ? params.transport
            : {
                ...params.transport,
                args: params.transport.args ?? [],
                env: params.transport.env ?? {},
              },
        auth: params.auth,
        secretNames: [],
        enabled: true,
        // An OAuth app is still signing in in the browser when add answers.
        status: params.auth === 'oauth' ? 'connecting' : 'connected',
        tools: [],
      };
      fake.connections.connections.push(added);
      return Promise.resolve(added);
    },
    setConnectionEnabled(id, enabled) {
      return Promise.resolve(update(id, { enabled, status: enabled ? 'connected' : 'off' }));
    },
    signInConnection(id) {
      signIns.push(id);
      return Promise.resolve(update(id, { status: 'connecting' }));
    },
    removeConnection(id) {
      removedConnections.push(id);
      fake.connections.connections = fake.connections.connections.filter((c) => c.id !== id);
      return Promise.resolve(true);
    },
    routines: [...(options.routines ?? [])],
    ranRoutines,
    confirmedRoutines,
    dismissedRoutines,
    editedRoutines,
    listRoutines() {
      return Promise.resolve(structuredClone(fake.routines));
    },
    saveRoutine(routine) {
      const saved = toView(routine);
      const index = fake.routines.findIndex((r) => r.id === saved.id);
      if (index === -1) fake.routines.push(saved);
      else fake.routines[index] = saved;
      return Promise.resolve(saved);
    },
    deleteRoutine(id) {
      const before = fake.routines.length;
      fake.routines = fake.routines.filter((r) => r.id !== id);
      return Promise.resolve(fake.routines.length < before);
    },
    setRoutineEnabled(id, enabled) {
      const index = fake.routines.findIndex((r) => r.id === id);
      fake.routines[index] = { ...fake.routines[index]!, enabled };
      return Promise.resolve(fake.routines[index]!);
    },
    runRoutine(id) {
      ranRoutines.push(id);
      return Promise.resolve(true);
    },
    confirmRoutine(proposalId, routine) {
      confirmedRoutines.push({ proposalId, ...(routine !== undefined ? { routine } : {}) });
      return Promise.resolve({
        routine: toView(routine ?? { name: 'Saved', when: { type: 'launch' }, what: 'x' }),
      });
    },
    dismissRoutine(proposalId) {
      dismissedRoutines.push(proposalId);
      return Promise.resolve();
    },
    editRoutine(proposal) {
      editedRoutines.push(proposal);
      return Promise.resolve();
    },
    sightLog: [...(options.sightLog ?? [])],
    listSightLog() {
      return Promise.resolve([...fake.sightLog]);
    },
    deleteSightLog(id) {
      const before = fake.sightLog.length;
      fake.sightLog = fake.sightLog.filter((entry) => entry.id !== id);
      return Promise.resolve(fake.sightLog.length < before);
    },
    clearSightLog() {
      const deleted = fake.sightLog.length;
      fake.sightLog = [];
      return Promise.resolve(deleted);
    },
    copied,
    copyText(text) {
      copied.push(text);
      return Promise.resolve();
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
