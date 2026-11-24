/**
 * An in-memory HostBridge for tests, with `emit` to push brain events and arrays that
 * record what the components asked for. Contains createFakeHostBridge and FakeHostBridge.
 */

import type {
  AppAddParams,
  AppInfo,
  BodiesState,
  DevicesState,
  PlacementsState,
  PairOffer,
  TailscaleState,
  LoopsState,
  TimerRow,
  TaskRow,
  WaitingEvent,
  UpdateResult,
  UpdatesState,
  Pet,
  KnowMeInput,
  KnowMeStatus,
  KnowSourceInfo,
  MemoryEntry,
  ModelState,
  SttState,
  TtsState,
  VoiceDownload,
  SetupOverview,
  SetupResult,
  TurnEvent,
  WhatsAppChange,
} from '../shapes';
import { placeKey } from '../shapes';
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
  PermissionGroup,
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
  /** Scout's portrait of the person. */
  portrait: string | null;
  /** Every knowMeStart input, in order, and how many onKnowMeStatus listeners are attached. */
  readonly knowStarts: readonly KnowMeInput[];
  readonly knowStatusListeners: number;
  /** Pushes a run status to every onKnowMeStatus subscriber. */
  emitKnowStatus(status: KnowMeStatus): void;
  /** Home's Permissions rows; setPermission edits them, a test may swap them. */
  permissions: PermissionRow[];
  /** Home's Permissions groups, in order; derived from the rows' `group` when a test sets none. */
  permissionGroups: PermissionGroup[] | null;
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
  /** The speech models as the brain reports them, every choice handed to setStt, and a refusal. */
  stt: SttState;
  readonly sttSets: readonly { live?: string; final?: string }[];
  sttError: string | null;
  /** The speaking voices as the brain reports them, every voice handed to setTts, and a refusal. */
  tts: TtsState;
  readonly ttsSets: readonly string[];
  ttsError: string | null;
  /** Every `[voice, speed]` handed to playVoiceSample; sampleError makes the next ones reject. */
  readonly samplesPlayed: readonly [string, number][];
  sampleError: string | null;
  /** What voiceDownload answers; null makes it fail. Each fetchVoice call's `retry` is kept. */
  voiceDownloadState: VoiceDownload | null;
  readonly voiceFetches: boolean[];
  readonly walkthroughOpens: readonly (number | undefined)[];
  /** Every setPermission call, in order. */
  readonly permissionSets: readonly { tool: string; mode: 'off' | 'ask' | 'auto' }[];
  /** Home's loops state; the loops calls edit it, a test may swap it. */
  loops: LoopsState;
  /** Every loops call made, in order: `set gmail on`, `forget id`, `wipe`. */
  readonly loopCalls: readonly string[];
  /** The brain's updates state; a test may swap it, then `emitChanged('updates')`. */
  updates: UpdatesState;
  /** Every updates call, in order: `check`, `item app github`, `all expert`, `auto app official on`. */
  readonly updateCalls: readonly string[];
  /** Home's timers; cancelTimer edits it, a test may swap it. */
  timers: TimerRow[];
  /** Home's waiting news. */
  waiting: WaitingEvent[];
  /** Home's task list. */
  tasks: TaskRow[];
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
  /** Every stopTask call's task id, in order. */
  readonly taskStops: readonly string[];
  /** How many times Retry was pressed on the brain setup line. */
  readonly setupRetries: () => number;
  /** The brain card's calls in order: `restart`, `restart-after-work`, `open-folder`, `open-log`, `copy-details`. */
  readonly brainActions: readonly string[];
  /** The paired devices and AI tools; rename and revoke edit them. A test may swap them. */
  devices: DevicesState;
  /** Where each app and expert runs; setPlacement edits it. */
  placements: PlacementsState;
  /** Every setPlacement, in order: `kind:id mode`. */
  readonly placementCalls: readonly string[];
  /** Every rename and revoke, in order: `rename id name`, `revoke id`. */
  readonly deviceCalls: readonly string[];
  /** Every text copied. */
  readonly copied: readonly string[];
  /** pairMake rejects with this message when set (`network_off`). */
  pairError: string | undefined;
  /** installBrainService answers this; `{ ok: false, detail }` is a refusal. */
  serviceOutcome: { ok: true } | { ok: false; detail: string };
  tailscale: TailscaleState;
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
    checkBackAt?: string;
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
    { id: 'desktop', kind: 'desktop', name: 'Desktop', connected: true },
    { id: 'browser', kind: 'browser', name: 'Browser', connected: false },
    { id: 'whatsapp', kind: 'whatsapp', name: 'WhatsApp', connected: false },
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

/** One speech model as the brain lists it. */
function sttRow(id: string, label: string, role: 'live' | 'final', size_mb: number) {
  return { id, label, role, size_mb, gpu: 'none' as const, languages: ['en'], note: '' };
}

function ttsRow(id: string, label: string, size_mb: number, installed: boolean) {
  return {
    id,
    label,
    descriptor: 'Warm, British',
    engine: id.split('-')[0] ?? 'piper',
    size_mb,
    licence: 'MIT',
    installed,
    sample: true,
  };
}

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
    /** Scout's portrait of the person; none by default. */
    portrait?: string | null;
    /** The sources get to know me lists. */
    knowSources?: KnowSourceInfo[];
    /** Makes knowMeStart reject with this sentence. */
    knowStartError?: string;
    /** Home's Permissions rows. */
    permissions?: PermissionRow[];
    /** The groups those rows sit in; one per distinct `group`, titled by it, when left out. */
    permissionGroups?: PermissionGroup[];
    /** Home's loops state. */
    loops?: LoopsState;
    /** Home's timers. */
    timers?: TimerRow[];
    /** Home's waiting news. */
    waiting?: WaitingEvent[];
    /** Home's task list. */
    tasks?: TaskRow[];
    /** What updatesState answers; defaults to nothing out of date, the default switches. */
    updates?: Partial<UpdatesState>;
    /** What updateItem and updateAll answer; defaults to `{ started: true }`. */
    updateResult?: UpdateResult;
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
    devices?: DevicesState;
    placements?: PlacementsState;
    tailscale?: TailscaleState;
  } = {},
): FakeHostBridge {
  const handlers = new Set<(event: TurnEvent) => void>();
  const changedHandlers = new Set<(what: string) => void>();
  const knowHandlers = new Set<(status: KnowMeStatus) => void>();
  const knowStarts: KnowMeInput[] = [];
  const approvedHandlers = new Set<
    (n: { tool: string; text: string; preference: string; cameUp?: boolean }) => void
  >();
  const approvalListCalls: { filter: 'all' | 'scout' | 'refused'; before?: number }[] = [];
  const preferenceRemovals: number[] = [];
  const preferenceEdits: { id: number; sentence: string }[] = [];
  const asks: AskInput[] = [];
  const interrupts: string[] = [];
  const approvals: { approvalId: string; decision: 'once' | 'always' | 'deny' }[] = [];
  const jobAnswers: { approvalId: string; option: string; text?: string; checkBackAt?: string }[] =
    [];
  const addedConnections: AppAddParams[] = [];
  const enabledCalls: { id: string; enabled: boolean }[] = [];
  const restarts: string[] = [];
  const signIns: string[] = [];
  const removedConnections: string[] = [];
  const setupCalls: SetupCall[] = [];
  const setupOverviewCalls: { query?: string; cursor?: string }[] = [];
  const permissionSets: { tool: string; mode: 'off' | 'ask' | 'auto' }[] = [];
  const cancelledTimers: string[] = [];
  const updateCalls: string[] = [];
  const loopCalls: string[] = [];
  const whatsappChanges: WhatsAppChange[] = [];
  const readingCalls: string[] = [];
  const jobStops: string[] = [];
  const taskStops: string[] = [];
  let setupRetries = 0;
  const brainActions: string[] = [];
  const deviceCalls: string[] = [];
  const placementCalls: string[] = [];
  const copied: string[] = [];
  const activityCalls: [string, number][] = [];
  const reportCalls: [string, string][] = [];
  const keysSet: string[] = [];
  const limitsSet: number[] = [];
  const modelsSet: string[] = [];
  const sttSets: { live?: string; final?: string }[] = [];
  const ttsSets: string[] = [];
  const samplesPlayed: [string, number][] = [];
  const voiceFetches: boolean[] = [];
  const walkthroughOpens: (number | undefined)[] = [];

  const fake: FakeHostBridge = {
    asks,
    interrupts,
    ask(input) {
      asks.push(input);
      return Promise.resolve();
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
      popularMore: [],
      showMoreFrom: null,
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
    portrait: options.portrait ?? null,
    knowStarts,
    get knowStatusListeners() {
      return knowHandlers.size;
    },
    emitKnowStatus(status) {
      for (const handler of [...knowHandlers]) handler(status);
    },
    getPortrait() {
      return Promise.resolve(fake.portrait);
    },
    knowMeSources() {
      return Promise.resolve(
        structuredClone(
          options.knowSources ?? [
            { name: 'github', needs: 'username', label: 'GitHub' },
            { name: 'linkedin', needs: 'file', label: 'LinkedIn PDF' },
            { name: 'web', needs: 'none', label: 'The web' },
          ],
        ),
      );
    },
    knowMeStart(input) {
      knowStarts.push(input);
      if (options.knowStartError !== undefined) {
        return Promise.reject(new Error(options.knowStartError));
      }
      return Promise.resolve({ joined: false });
    },
    onKnowMeStatus(handler) {
      knowHandlers.add(handler);
      return () => {
        knowHandlers.delete(handler);
      };
    },
    listMemories() {
      return Promise.resolve([...fake.memories]);
    },
    deleteMemory(id) {
      const before = fake.memories.length;
      fake.memories = fake.memories.filter((memory) => memory.id !== id);
      return Promise.resolve(fake.memories.length < before);
    },
    loops: options.loops ?? { apps: [], loops: [], openItems: [] },
    timers: options.timers ?? [],
    waiting: options.waiting ?? [],
    tasks: options.tasks ?? [],
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
      fake.loops = {
        apps: fake.loops.apps.map((a) => ({ ...a, on: false })),
        loops: [],
        openItems: [],
      };
      return Promise.resolve();
    },
    updates: {
      checkedAt: null,
      auto: {
        apps: { official: true, community: false },
        experts: { official: true, community: false },
      },
      items: [],
      ...options.updates,
    },
    updateCalls,
    updatesState() {
      return Promise.resolve(structuredClone(fake.updates));
    },
    updatesCheck() {
      updateCalls.push('check');
      return Promise.resolve(structuredClone(fake.updates));
    },
    updateItem(kind, id) {
      updateCalls.push(`item ${kind} ${id}`);
      return Promise.resolve(options.updateResult ?? { started: true });
    },
    updateAll(kind) {
      updateCalls.push(`all ${kind}`);
      return Promise.resolve(options.updateResult ?? { started: true });
    },
    setAutoUpdate(kind, official, on) {
      updateCalls.push(`auto ${kind} ${official ? 'official' : 'community'} ${on ? 'on' : 'off'}`);
      const group = kind === 'app' ? fake.updates.auto.apps : fake.updates.auto.experts;
      group[official ? 'official' : 'community'] = on;
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
    eventsWaiting() {
      return Promise.resolve(structuredClone(fake.waiting));
    },
    tasksList() {
      return Promise.resolve(structuredClone(fake.tasks));
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
    permissionGroups: options.permissionGroups ?? null,
    permissionSets,
    listPermissions() {
      const rows = fake.permissions.map((row) => ({ ...row }));
      const groups =
        fake.permissionGroups ??
        [...new Set(rows.map((row) => row.group))].map((id) => ({ id, title: id, note: '' }));
      return Promise.resolve({ groups, rows });
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
    taskStops,
    setupRetries: () => setupRetries,
    brainActions,
    deviceCalls,
    copied,
    devices: options.devices ?? { devices: [], aiTools: [] },
    pairError: undefined,
    serviceOutcome: { ok: true },
    tailscale: options.tailscale ?? { installed: false, ip: null },
    placements: options.placements ?? { thisPc: 'node-this', places: {} },
    placementCalls,
    placementsState() {
      return Promise.resolve(structuredClone(fake.placements));
    },
    setPlacement(kind, id, place) {
      placementCalls.push(
        `${kind}:${id} ${place.mode}${place.prefer === null ? '' : ` ${place.prefer}`}`,
      );
      fake.placements = {
        ...fake.placements,
        places: { ...fake.placements.places, [placeKey(kind, id)]: place },
      };
      return Promise.resolve();
    },
    devicesState() {
      return Promise.resolve(structuredClone(fake.devices));
    },
    renameDevice(id, name) {
      deviceCalls.push(`rename ${id} ${name}`);
      const edit = (rows: DevicesState['devices']) =>
        rows.map((row) => (row.id === id ? { ...row, name } : row));
      fake.devices = { devices: edit(fake.devices.devices), aiTools: edit(fake.devices.aiTools) };
      return Promise.resolve();
    },
    revokeDevice(id) {
      deviceCalls.push(`revoke ${id}`);
      fake.devices = {
        devices: fake.devices.devices.filter((row) => row.id !== id),
        aiTools: fake.devices.aiTools.filter((row) => row.id !== id),
      };
      return Promise.resolve();
    },
    pairMake() {
      if (fake.pairError !== undefined) return Promise.reject(new Error(fake.pairError));
      const offer: PairOffer = {
        link: 'tagalong://pair?addr=192.168.1.20:47323&fp=ab&code=xyz',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        qr: '███\n█ █\n███\n',
      };
      return Promise.resolve(offer);
    },
    copyText(text) {
      copied.push(text);
      return Promise.resolve();
    },
    installBrainService() {
      brainActions.push('install-service');
      if (fake.serviceOutcome.ok && options.brainCard !== undefined) {
        options.brainCard = { ...options.brainCard, startedBy: 'service', network: true };
      }
      return Promise.resolve(fake.serviceOutcome);
    },
    forgetBrain() {
      brainActions.push('forget-brain');
      return Promise.resolve();
    },
    reconnectBrain() {
      brainActions.push('reconnect');
      return Promise.resolve();
    },
    tailscaleState() {
      return Promise.resolve({ ...fake.tailscale });
    },
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
    stt: {
      live: 'auto',
      final: 'auto',
      gpu_name: 'NVIDIA GeForce RTX 4060',
      models: [
        sttRow('moonshine-tiny', 'Moonshine tiny', 'live', 45),
        sttRow('moonshine-small', 'Moonshine small', 'live', 120),
        sttRow('whisper-small-en', 'Whisper small (English)', 'final', 462),
        sttRow('whisper-large-v3-turbo', 'Whisper large v3 turbo', 'final', 1543),
      ],
    },
    sttSets,
    sttError: null,
    tts: {
      chosen: 'auto',
      resolved: 'piper-alan',
      voices: [
        ttsRow('piper-alan', 'Alan', 63, true),
        ttsRow('kokoro-bm-george', 'George', 92, false),
      ],
      download: { voice: 'piper-alan', status: 'ready', progress: 1 },
    },
    ttsSets,
    ttsError: null,
    samplesPlayed,
    sampleError: null,
    ttsState() {
      return Promise.resolve({ ...fake.tts });
    },
    setTts(voice) {
      if (fake.ttsError !== null) return Promise.reject(new Error(fake.ttsError));
      ttsSets.push(voice);
      fake.tts = { ...fake.tts, chosen: voice };
      return Promise.resolve();
    },
    playVoiceSample(voice, speed) {
      if (fake.sampleError !== null) return Promise.reject(new Error(fake.sampleError));
      samplesPlayed.push([voice, speed]);
      return Promise.resolve();
    },
    voiceDownloadState: { status: 'ready', progress: 1 },
    voiceFetches,
    voiceDownload() {
      return fake.voiceDownloadState === null
        ? Promise.reject(new Error('brain offline'))
        : Promise.resolve({ ...fake.voiceDownloadState });
    },
    fetchVoice(retry = false) {
      voiceFetches.push(retry);
      return Promise.resolve();
    },
    sttState() {
      return Promise.resolve({ ...fake.stt });
    },
    setStt(choice) {
      if (fake.sttError !== null) return Promise.reject(new Error(fake.sttError));
      sttSets.push(choice);
      fake.stt = { ...fake.stt, ...choice };
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
          model: 'Claude Opus 5.5',
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
    stopBrain() {
      brainActions.push('stop');
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
    stopTask(task) {
      taskStops.push(task);
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
