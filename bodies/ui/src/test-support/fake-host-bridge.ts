/**
 * An in-memory HostBridge for tests, with `emit` to push engine events and arrays that
 * record what the components asked for. Contains createFakeHostBridge and FakeHostBridge.
 */

import type {
  ActivityEntry,
  Ask,
  Episode,
  EpisodeEvent,
  SelfNight,
  SelfVersion,
  AppAddParams,
  AppInfo,
  CalendarCheckResult,
  ContextSnapshot,
  CatalogStatus,
  Expert,
  PerceptionTarget,
  Pet,
  ProjectCandidate,
  RoutineDraftInput,
  RoutineProposedParams,
  RoutineView,
  SightLogEntry,
  SettingsPatch,
  MemoryEntry,
} from '@tagalong/protocol';
import type {
  AskInput,
  ConfirmHandoff,
  HostBridge,
  JobRow,
  PermissionRow,
  TurnEvent,
} from '../host-bridge';

export interface FakeHostBridge extends HostBridge {
  /** Delivers an event to every subscriber synchronously, so tests need no timers. */
  emit(event: TurnEvent): void;
  /** Tells every `onBrainChanged` subscriber that the brain changed `what`. */
  emitChanged(what: string): void;
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
  /** How many times the activity was listed. */
  activityReads: number;
  /** The experience log, newest first, and each episode's events by id. */
  episodes: Episode[];
  episodeEvents: Record<string, EpisodeEvent[]>;
  /** Scout's notes by path, their versions newest first, and the nights slept. */
  selfPages: Record<string, string>;
  selfVersions: SelfVersion[];
  nights: SelfNight[];
  /** Home's experts, as saved; a test reads them back after a save. */
  experts: Expert[];
  /** Every expert id tested, in order. */
  readonly testedExperts: readonly string[];
  /** Every catalog entry installed, in order. */
  readonly installedCatalog: readonly string[];
  /** Every hand-off the person sent, dismissed or stopped, in order. */
  readonly confirmedHandoffs: readonly ConfirmHandoff[];
  readonly dismissedHandoffs: readonly string[];
  readonly cancelledHandoffs: readonly string[];
  /** Every answer to a connector confirm card, in order. */
  readonly approvals: readonly { approvalId: string; decision: 'once' | 'always' | 'deny' }[];
  /** Every answer to a Claude Code job's ask (its own option, or typed text), in order. */
  readonly jobAnswers: readonly { approvalId: string; option: string; text?: string }[];
  /** Every saved ask, waiting or answered; a test edits it, then emits `asks.changed`. */
  savedAsks: Ask[];
  /** Every answer from Waiting on you, and every Open, in order. */
  readonly answeredAsks: readonly { id: string; decision: 'approve' | 'decline' }[];
  readonly openedAsks: readonly string[];
  /** The brain's apps; a test edits them, then emits `connections.changed`. */
  apps: AppInfo[];
  readonly addedConnections: readonly AppAddParams[];
  readonly enabledCalls: readonly { id: string; enabled: boolean }[];
  readonly restarts: readonly string[];
  readonly removedConnections: readonly string[];
  /** Home's routines, as saved; a test reads them back after a save. */
  routines: RoutineView[];
  readonly ranRoutines: readonly string[];
  readonly confirmedRoutines: readonly { proposalId: string; routine?: RoutineDraftInput }[];
  readonly dismissedRoutines: readonly string[];
  readonly editedRoutines: readonly RoutineProposedParams[];
  /** Every text put on the clipboard with Copy, in order. */
  readonly copied: readonly string[];
  /** Every calendar link Home handed over, in order. */
  readonly calendarLinks: readonly (string | null)[];
  /** Every patch a settings card applied, in order. */
  readonly appliedSettings: readonly SettingsPatch[];
}

/**
 * Shipped from the package rather than kept in test files: the extension's side-panel tests
 * use the same bridge double without booting an engine.
 */
export function createFakeHostBridge(
  options: {
    pets?: Pet[];
    capture?: ContextSnapshot | null;
    /** Home's activity, newest first. */
    activity?: ActivityEntry[];
    /** The experience log, newest first. */
    episodes?: Episode[];
    episodeEvents?: Record<string, EpisodeEvent[]>;
    /** Scout's notes by path; the three core pages are always there. */
    selfPages?: Record<string, string>;
    selfVersions?: SelfVersion[];
    nights?: SelfNight[];
    /** writeSelf rejects, as when the engine is restarting. */
    selfWriteFails?: boolean;
    experts?: Expert[];
    /** What testing an expert answers; absent answers ready. */
    testExpert?: (expertId: string) => { ok: boolean; error?: string };
    /** The expert catalog; absent is empty. */
    catalog?: CatalogStatus[];
    /** What installing answers; absent answers installed. */
    installExpert?: (catalogId: string) => { ok: boolean; installed: string[]; error?: string };
    /** What the folder picker answers; absent means the host has no picker. */
    pickFolder?: () => string | null;
    /** What a project search answers; absent answers nothing found. */
    searchProjects?: (query: string) => ProjectCandidate[];
    /** The brain's apps to start with. */
    apps?: AppInfo[];
    /** Listing apps rejects with this message, as "brain offline" does. */
    listFails?: string;
    routines?: RoutineView[];
    /** What Scout saw, newest first. */
    sightLog?: SightLogEntry[];
    /** What Scout remembers, newest first. */
    memories?: MemoryEntry[];
    /** Home's Permissions rows. */
    permissions?: PermissionRow[];
    /** Home's Jobs rows. */
    jobs?: JobRow[];
    /** Whether a calendar link is kept; absent, none is. */
    calendar?: CalendarCheckResult;
    /** Every ask, waiting or answered. */
    savedAsks?: Ask[];
    /** answerAsk rejects, as when the engine is restarting. */
    answerAskFails?: boolean;
  } = {},
): FakeHostBridge {
  const handlers = new Set<(event: TurnEvent) => void>();
  const changedHandlers = new Set<(what: string) => void>();
  const asks: AskInput[] = [];
  const interrupts: string[] = [];
  const stoppedWatches: string[] = [];
  const captures: (readonly PerceptionTarget[])[] = [];
  let turnCount = 0;
  const testedExperts: string[] = [];
  const installedCatalog: string[] = [];
  const confirmedHandoffs: ConfirmHandoff[] = [];
  const dismissedHandoffs: string[] = [];
  const cancelledHandoffs: string[] = [];
  const approvals: { approvalId: string; decision: 'once' | 'always' | 'deny' }[] = [];
  const answeredAsks: { id: string; decision: 'approve' | 'decline' }[] = [];
  const jobAnswers: { approvalId: string; option: string; text?: string }[] = [];
  const openedAsks: string[] = [];
  const addedConnections: AppAddParams[] = [];
  const enabledCalls: { id: string; enabled: boolean }[] = [];
  const restarts: string[] = [];
  const removedConnections: string[] = [];
  const ranRoutines: string[] = [];
  const confirmedRoutines: { proposalId: string; routine?: RoutineDraftInput }[] = [];
  const dismissedRoutines: string[] = [];
  const editedRoutines: RoutineProposedParams[] = [];
  const copied: string[] = [];
  const calendarLinks: (string | null)[] = [];
  const appliedSettings: SettingsPatch[] = [];
  const permissionSets: { tool: string; mode: 'ask' | 'auto' }[] = [];
  const jobStops: string[] = [];
  let calendar: CalendarCheckResult = options.calendar ?? { linked: false, meetings: 0 };
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
    episodes: [...(options.episodes ?? [])],
    episodeEvents: { ...options.episodeEvents },
    listExperience(params = {}) {
      const limit = params.limit ?? 30;
      const start =
        params.before === undefined
          ? 0
          : fake.episodes.findIndex((episode) => episode.id === params.before) + 1;
      const episodes = fake.episodes.slice(start, start + limit);
      const last = episodes.at(-1);
      const more = start + limit < fake.episodes.length && last !== undefined;
      return Promise.resolve(more ? { episodes, next: last.id } : { episodes });
    },
    clearExperience() {
      const deleted = fake.episodes.length;
      fake.episodes = [];
      return Promise.resolve(deleted);
    },
    getExperience(id) {
      const episode = fake.episodes.find((candidate) => candidate.id === id);
      return Promise.resolve(
        episode === undefined ? null : { episode, events: fake.episodeEvents[id] ?? [] },
      );
    },
    selfPages: { 'you.md': '', 'lessons.md': '', 'commitments.md': '', ...options.selfPages },
    selfVersions: (options.selfVersions ?? []).map((version) => ({ ...version })),
    nights: [...(options.nights ?? [])],
    listSelf() {
      return Promise.resolve({
        pages: Object.entries(fake.selfPages).map(([path, text]) => ({
          path,
          chars: text.length,
          proposals: fake.selfVersions.filter((v) => v.path === path && v.state === 'proposed')
            .length,
        })),
        nights: fake.nights,
      });
    },
    getSelf(path) {
      const text = fake.selfPages[path];
      return Promise.resolve(
        text === undefined
          ? null
          : { path, text, versions: fake.selfVersions.filter((v) => v.path === path) },
      );
    },
    writeSelf(path, text) {
      if (options.selfWriteFails === true) return Promise.reject(new Error('engine restarting'));
      const kept = text.slice(0, 6_000);
      fake.selfPages[path] = kept;
      fake.selfVersions.unshift({
        id: fake.selfVersions.length + 100,
        path,
        author: 'person',
        why: 'Edited in Home.',
        state: 'applied',
        text: kept,
        chars: kept.length,
        at: new Date(0).toISOString(),
      });
      return Promise.resolve(
        kept.length < text.length
          ? { ok: true, note: 'Saved the first 6000 characters: the page holds no more.' }
          : { ok: true },
      );
    },
    undoSelf(versionId) {
      const version = fake.selfVersions.find((v) => v.id === versionId);
      if (version === undefined) return Promise.resolve({ ok: false, reason: 'Gone.' });
      fake.selfPages[version.path] = '';
      return Promise.resolve({ ok: true });
    },
    acceptSelf(versionId) {
      const version = fake.selfVersions.find((v) => v.id === versionId);
      if (version?.state !== 'proposed') return Promise.resolve({ ok: false, reason: 'Gone.' });
      version.state = 'accepted';
      fake.selfPages[version.path] = version.text;
      return Promise.resolve({ ok: true });
    },
    rejectSelf(versionId) {
      const version = fake.selfVersions.find((v) => v.id === versionId);
      if (version?.state !== 'proposed') return Promise.resolve({ ok: false, reason: 'Gone.' });
      version.state = 'rejected';
      return Promise.resolve({ ok: true });
    },
    experts: [...(options.experts ?? [])],
    testedExperts,
    installedCatalog,
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
    expertCatalog() {
      return Promise.resolve([...(options.catalog ?? [])]);
    },
    installExpert(catalogId) {
      installedCatalog.push(catalogId);
      return Promise.resolve(options.installExpert?.(catalogId) ?? { ok: true, installed: [] });
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
    jobAnswers,
    answerJobAsk(approvalId, answer) {
      jobAnswers.push({ approvalId, ...answer });
      return Promise.resolve();
    },
    savedAsks: (options.savedAsks ?? []).map((ask) => ({ ...ask })),
    answeredAsks,
    openedAsks,
    listAsks() {
      return Promise.resolve({
        waiting: fake.savedAsks.filter((ask) => ask.state === 'waiting'),
        recent: fake.savedAsks.filter((ask) => ask.state !== 'waiting'),
      });
    },
    answerAsk(id, decision) {
      if (options.answerAskFails === true) return Promise.reject(new Error('engine restarting'));
      answeredAsks.push({ id, decision });
      const ask = fake.savedAsks.find((candidate) => candidate.id === id);
      if (ask?.state !== 'waiting') return Promise.resolve(false);
      ask.state = decision === 'approve' ? 'approved' : 'declined';
      ask.answeredBy = 'you';
      return Promise.resolve(true);
    },
    openAsk(id) {
      openedAsks.push(id);
      return Promise.resolve(true);
    },
    apps: [...(options.apps ?? [])],
    addedConnections,
    enabledCalls,
    restarts,
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
        status: 'connected',
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
    removeConnection(id) {
      removedConnections.push(id);
      fake.apps = fake.apps.filter((a) => a.id !== id);
      return Promise.resolve({ id, removed: true });
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
    listJobs() {
      return Promise.resolve(fake.jobs.map((row) => ({ ...row })));
    },
    stopJob(job) {
      jobStops.push(job);
      return Promise.resolve();
    },
    copied,
    appliedSettings,
    applySettings(patch) {
      appliedSettings.push(patch);
      return Promise.resolve();
    },
    copyText(text) {
      copied.push(text);
      return Promise.resolve();
    },
    calendarLinks,
    setCalendarLink(link) {
      calendarLinks.push(link);
      calendar = link === null ? { linked: false, meetings: 0 } : { linked: true, meetings: 1 };
      return Promise.resolve(calendar);
    },
    checkCalendar() {
      return Promise.resolve(calendar);
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
