/**
 * The HostBridge contract: every call and notification a ui component may use, which each
 * host (the Electron app, the browser extension) implements. Contains HostBridge, TurnEvent,
 * AskInput, and the HostBridgeProvider / useHostBridge React context.
 */

import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import type {
  AppAddParams,
  AppsList,
  BodiesState,
  ContextSnapshot,
  FixTarget,
  LoopsState,
  MemoryEntry,
  Pet,
  SetupOverview,
  SetupResult,
  TimerRow,
  TurnEvent,
  WhatsAppChange,
} from './shapes';
import type { HealthFacts } from './health';

/** What the brain knows of spend: today's dollars and the daily limit (null when it has none). */
export interface SpendToday {
  spentUsd: number;
  limitUsd: number | null;
}

/**
 * What the brain says of its Anthropic key: whether it has one and where it came from. Never any
 * part of the key. `envPath` is where the brain saves a key it is given.
 */
export interface KeyStatus {
  hasKey: boolean;
  source: 'environment' | 'file' | 'none';
  envPath: string;
  dailyLimitUsd: number;
}

/** How a key check ended; `offline` is the body's own word for "no brain connected". */
export type KeyResult = 'ok' | 'invalid' | 'unreachable' | 'offline';

/**
 * One tool in Home's Permissions list: removed from Scout's toolbox (`off`), asked about before
 * each use (`ask`) or just used (`auto`). A locked tool asks until set to auto on Home; `source`
 * says where it comes from. An offline body's tool can still be set.
 */
export interface PermissionRow {
  name: string;
  description: string;
  effect: 'read' | 'change';
  mode: 'off' | 'ask' | 'auto';
  locked: boolean;
  /** The tool opens its own ask with the person: Off or Ask only, never Auto (brain's flag). */
  self_asks?: boolean;
  online: boolean;
  /** The tool always needs the person's yes: Off or Ask, never Auto (brain's flag). */
  person_only: boolean;
  /** Anthropic runs the tool inside its reply, so no ask can reach it: Off or Auto, never Ask. */
  server_tool?: boolean;
  /** Where the tool comes from: `built_in`, `body:<id>` or `app:<id>`. */
  source: string;
  /** The heading to group under: the body's declared name or the app's name. */
  source_name: string;
  /** What the person reads: a plain name, one line, and the longer text behind the info button. */
  title: string;
  line: string;
  info: string;
  /** The id of the `PermissionGroup` this row is listed under. */
  group: string;
}

/** One collapsible group in the Permissions list, in the order the brain sends them. */
export interface PermissionGroup {
  id: string;
  title: string;
  note: string;
}

/** One Claude Code job in Home's Jobs panel, as the brain's list_jobs sends it. */
export interface JobRow {
  id: string;
  task: string;
  folder: string;
  mode: string;
  state: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
  closedAt: string | null;
  /** Scout's own write-up of the job, or null until it writes one. */
  scoutResult: string | null;
  /** One per expert hand-off, oldest first; an old job has exactly one. */
  parts: JobPartRow[];
  /** True when the brain kept steps for this job, so Home can offer to watch it. */
  activity: boolean;
}

/** One expert hand-off inside a job. */
export interface JobPartRow {
  id: string;
  expert: string;
  state: string;
  reason: string | null;
  progress: string | null;
  result: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** One step of a job, as the brain's job_activity sends it (text is already masked). */
export interface JobActivityEntry {
  rev: number;
  seq: number;
  at: string;
  kind: string;
  text: string;
  status: string | null;
  step: string | null;
  exit: number | null;
  /** Which part (expert hand-off) of the job the step belongs to. */
  part: string;
  source: string | null;
}

/** A part as the job page header shows it (no progress or result: the steps tell that). */
export interface JobPagePart {
  id: string;
  expert: string;
  state: string;
  reason: string | null;
  folder: string;
  startedAt: string;
  endedAt: string | null;
}

/** A page of a job's steps after a cursor; pass `rev` back as the next `afterRev`. */
export interface JobActivityPage {
  job: string;
  state: string;
  title: string | null;
  startedAt: string;
  endedAt: string | null;
  closedAt: string | null;
  /** Scout's own result for the job; null until it writes one. */
  result: string | null;
  parts: JobPagePart[];
  rev: number;
  entries: JobActivityEntry[];
  more: boolean;
  /** What Scout said it expects from the job; null when it has said nothing (or cleared it). */
  watch: WatchItem[] | null;
}

/** One line of Scout's watch list for a job; the owner sees it read-only. */
export interface WatchItem {
  text: string;
  done: boolean;
}

/** The step a running job is on now, for the bubble's one live line. */
export interface RunningStep {
  job: string;
  expert: string;
  text: string;
  at: string;
}

/** One permission decision in Home's Approvals history, as the brain's list_approvals sends it. */
export interface ApprovalRow {
  id: number;
  source: 'scout_tool' | 'claude_code' | 'app';
  tool: string;
  summary: string;
  outcome: 'approved' | 'refused' | 'timed_out' | 'no_one' | 'expired';
  decidedBy: 'person' | 'scout' | 'rule' | 'none';
  /** The sentence Scout approved under; null when the person (or nobody) decided. */
  preference: string | null;
  at: string;
}

/** Totals over the whole history, not just the page shown. */
export interface ApprovalCounts {
  total: number;
  scout: number;
  refused: number;
}

/** One sentence the person gave Scout about what it may approve, as list_preferences sends it. */
export interface PreferenceRow {
  id: number;
  sentence: string;
  builtin: boolean;
  createdAt: string;
  useCount: number;
  lastUsed: string | null;
}

/** Where the desktop dials the brain (`ws://host:port`) and whether the link is up. */
export interface BrainLink {
  addr: string;
  status: 'connecting' | 'online' | 'offline' | 'outdated';
  /** The first-run install of the brain (packaged app only): idle when there is nothing to show. */
  setup: 'idle' | 'installing' | 'failed';
}

/** Scout's brain card on Home: the brain's own facts, or what the desktop knows while it is offline. */
export interface BrainCard {
  status: 'running' | 'offline';
  /** Ready: the brain is older than the app and can be restarted here. Terminal: the person started it. */
  update: 'none' | 'ready' | 'terminal';
  version: string | null;
  build: string | null;
  /** The app's own version and build, to show beside a brain that differs, and while offline. */
  appVersion: string;
  appBuild: string;
  /** ISO, UTC. */
  startedAt: string | null;
  startedBy: 'desktop' | 'person' | null;
  addr: string;
  pid: number | null;
  dataDir: string;
  logPath: string;
  places: { id: string; kind: string; name: string }[];
  workRunning: boolean;
}

export interface AskInput {
  petId: string;
  /** The conversation to continue. Absent opens a new one; turn.started reports its id. */
  conversationId?: string;
  text?: string;
  snapshot?: ContextSnapshot;
  /** The question was spoken (Talk to Scout): Scout answers the way a person talks. */
  spoken?: boolean;
  /**
   * Sends the item last dropped on Scout with the question. Set only by a button on the
   * drop card; the host reads the item then, and attaches it as `snapshot.dropped`.
   */
  drop?: boolean;
  /** The person spoke over this turn after hearing `heard` of its sentences; the brain hands the unsaid rest to the model. */
  interrupted?: { turn: string; heard: number };
}

/**
 * Everything this package is allowed to know about the outside world. The desktop app and
 * the browser extension each implement it; the components never touch a socket, a preload
 * bridge or a node API themselves.
 */
export interface HostBridge {
  ask(input: AskInput): Promise<{ turnId: string }>;
  interrupt(turnId: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onTurnEvent(handler: (event: TurnEvent) => void): () => void;
  /**
   * The confirm cards the body still holds open. A bubble that mounted after its ask arrived
   * (a relaunch) never saw the live event, so it asks for these once when it mounts.
   */
  openConfirms?(): Promise<TurnEvent[]>;
  listPets(): Promise<Pet[]>;
  /** The person's answer to a confirm card: run it once, always allow the tool, or deny it. */
  approveTool(approvalId: string, decision: 'once' | 'always' | 'deny'): Promise<void>;
  /**
   * The answer to a Claude Code job's ask: one of its own option names, or typed text for a
   * question. Separate from approveTool because these options are not allow/always/deny. A
   * hand-off card also sends `apps`, the ones the person kept (an empty list: none).
   */
  answerJobAsk(
    approvalId: string,
    answer: { option: string; text?: string; apps?: string[] },
  ): Promise<void>;
  /**
   * Home's Connections page: the apps the brain keeps (MCP). They reject with "brain offline"
   * while the brain is away.
   * Only `listConnections` and `addConnection` have answers worth reading; the page lists again
   * after the rest.
   */
  listConnections(): Promise<AppsList>;
  /**
   * Experts and apps with their state, what could be added, and a running install's progress.
   * A `query` searches the app registry; without one `browseApps` is its first page.
   */
  setupOverview(query?: string, cursor?: string): Promise<SetupOverview>;
  /**
   * Installs, updates or logs in an expert. `approved` false opens the Allow card (Connections);
   * true means the person's press was the OK (the tour), or with `communityOk` the Connections
   * page's "Connect anyway" on a community expert. Progress arrives as `changed setup`.
   */
  setupExpert(id: string, approved: boolean, communityOk?: boolean): Promise<SetupResult>;
  /**
   * `query` is the registry search the app was found with; the card needs it to find it again.
   * `approved` from Home connects an Official app at once; a community one also needs `communityOk`.
   */
  setupApp(
    id: string,
    approved: boolean,
    query?: string,
    communityOk?: boolean,
  ): Promise<SetupResult>;
  addConnection(params: AppAddParams): Promise<{ id: string }>;
  setConnectionEnabled(id: string, enabled: boolean): Promise<unknown>;
  restartConnection(id: string): Promise<unknown>;
  /** Opens the app's sign-in in the browser on the brain's machine; the outcome arrives as `connections.changed`. */
  signInConnection(id: string): Promise<unknown>;
  /** Remove: the brain forgets the app and deletes its stored key. */
  removeConnection(id: string): Promise<unknown>;
  /**
   * Home's What Scout remembers: its facts, preferences and summaries, newest first, each
   * deletable.
   */
  listMemories(): Promise<MemoryEntry[]>;
  deleteMemory(id: string): Promise<boolean>;
  /** The brain's key facts (never the key); rejects while the brain is away. */
  keyStatus(): Promise<KeyStatus>;
  /** Hands the pasted key to the brain once and keeps no copy; resolves how the check ended. */
  setKey(key: string): Promise<KeyResult>;
  /** Sets the daily spend limit in dollars (finite, above 0). */
  setDailyLimit(usd: number): Promise<void>;
  /** Opens the first-run walkthrough, at a step when one is named (9 is the key). */
  openWalkthrough(step?: number): Promise<void>;
  /** Home's Spend card: what was spent today and the daily limit, as the brain knows them. */
  usageSummary(): Promise<SpendToday>;
  /**
   * Home's Held list: the mail apps the loops switch is offered for and every loop held. Changes
   * arrive as `changed loops`. Rejects while the brain is away.
   */
  loopsState(): Promise<LoopsState>;
  /** Switches reading one mail app for loops on or off; off keeps the loops held. */
  setLoopsOn(app: string, on: boolean): Promise<void>;
  /** Deletes one held loop. */
  forgetLoop(id: string): Promise<void>;
  /** Closes one held loop: the person dealt with it. */
  loopDone(id: string): Promise<void>;
  /** Snoozes one held loop until an ISO time with offset; Scout may raise it again then. */
  loopLater(id: string, until: string): Promise<void>;
  /** Stop and wipe: every switch off, every loop and mail cursor deleted. */
  wipeLoops(): Promise<void>;
  /**
   * Home's Timers tab: every timer waiting to fire, soonest first. Changes arrive as `changed
   * timers`. Rejects while the brain is away.
   */
  timersState(): Promise<TimerRow[]>;
  /** Cancels one timer. */
  cancelTimer(id: string): Promise<void>;
  /**
   * Home's Bodies section: which bodies are connected and how WhatsApp is set up (which values
   * are saved, never the values). Changes arrive as `changed bodies`. Rejects while the brain is
   * away.
   */
  bodiesState(): Promise<BodiesState>;
  /**
   * Saves WhatsApp settings and switches the bridge. Only the fields given change; a secret goes
   * to the brain once and is never read back. Rejects with one fixed sentence on failure.
   */
  setWhatsApp(change: WhatsAppChange): Promise<void>;
  /**
   * How Scout reads the screen on this PC, as the brain's reading_status answer (JSON text; read
   * it with readingRowsOf). Changes arrive as `changed reading`. Rejects while the brain is away.
   */
  readingStatus(): Promise<string>;
  /** Detects how Scout reads the screen again and tells the brain (Home does this on open). */
  readingRecheck(): Promise<void>;
  /** Opens Windows Settings, Language and region. */
  openLanguageSettings(): Promise<void>;
  /**
   * Opens the companion and asks Scout `text` as if the person typed it (empty text is ignored).
   * Scout's usual ask still gates anything it does.
   */
  askScout(text: string): Promise<void>;
  /** Home's Permissions: each tool Scout can use and whether it asks first. */
  listPermissions(): Promise<{ groups: PermissionGroup[]; rows: PermissionRow[] }>;
  /** Sets one tool to off, ask or auto; rejects when the brain refuses (a locked tool, say). */
  setPermission(tool: string, mode: 'off' | 'ask' | 'auto'): Promise<void>;
  /** Home's Jobs panel: recent Claude Code jobs, newest first. */
  listJobs(): Promise<JobRow[]>;
  /** Stops one running job; rejects when the brain refuses (already ended, say). */
  stopJob(job: string): Promise<void>;
  /** A job's steps after `afterRev` (0 for all); rejects for an unknown job. */
  jobActivity(job: string, afterRev: number): Promise<JobActivityPage>;
  /** One part's report (masked by the brain), or null if it has none; rejects for an unknown part. */
  jobReport(job: string, part: string): Promise<string | null>;
  /** The step each running job is on; empty when none has started one. */
  runningSteps(): Promise<RunningStep[]>;
  /** Home's Approvals history, newest first; `before` is the `next` cursor of the page above. */
  listApprovals(
    filter: 'all' | 'scout' | 'refused',
    before?: number,
  ): Promise<{ approvals: ApprovalRow[]; counts: ApprovalCounts; next: number | null }>;
  /** The preferences Scout follows, the built-in one included. */
  listPreferences(): Promise<PreferenceRow[]>;
  /** Removes a preference; rejects when the brain refuses (already gone, say). */
  removePreference(id: number): Promise<void>;
  /** Rewrites a preference's sentence; rejects when the brain refuses it. */
  editPreference(id: number, sentence: string): Promise<void>;
  /** Scout approved an ask under a preference: tell the person once. Returns an unsubscribe. */
  onApproved(
    handler: (n: { tool: string; text: string; preference: string; cameUp?: boolean }) => void,
  ): () => void;
  /** Home's "Where things run": the brain's address and link status. */
  brainLink(): Promise<BrainLink>;
  /** Runs the first-run install again after it failed. */
  retryBrainSetup(): Promise<void>;
  /** Scout's brain card: version, who started it, where it keeps things, who is connected. */
  brainCard(): Promise<BrainCard>;
  /** Stops the brain and starts it again; rejects for a brain the person started. */
  restartBrain(): Promise<void>;
  /** Restarts the brain once no job is running. */
  restartBrainAfterWork(): Promise<void>;
  openBrainFolder(): Promise<void>;
  openBrainLog(): Promise<void>;
  /** Copies version, build, process id, address, data folder and who started it. */
  copyBrainDetails(): Promise<void>;
  /**
   * The brain changed something Home shows (`memory`, `permissions`; `link` when the connection
   * to the brain goes up or down): read it again. Returns an
   * unsubscribe function.
   */
  onBrainChanged(handler: (what: string) => void): () => void;
  /**
   * "Scout, what's wrong?": what the health card reads, from calls the host already makes.
   * No model call, so it works when Scout cannot think. Never a key or a secret.
   */
  checkHealth(): Promise<HealthFacts>;
  /** A health card's Fix it: opens the Settings section or Home page that fixes it. */
  openFix(target: FixTarget): Promise<void>;
  /** The health card's Open logs folder: shows the folder; no log text leaves the host. */
  openLogs(): Promise<void>;
}

const HostBridgeContext = createContext<HostBridge | null>(null);

interface HostBridgeProviderProps {
  bridge: HostBridge;
  children: ReactNode;
}

export function HostBridgeProvider({ bridge, children }: HostBridgeProviderProps): ReactNode {
  return createElement(HostBridgeContext.Provider, { value: bridge }, children);
}

/**
 * Throws rather than returning null: a component rendered without a bridge cannot do
 * anything useful, and a hard failure surfaces the wiring mistake in the host instead
 * of a panel that silently never answers.
 */
export function useHostBridge(): HostBridge {
  const bridge = useContext(HostBridgeContext);
  if (bridge === null) {
    throw new Error('useHostBridge must be used inside a HostBridgeProvider');
  }
  return bridge;
}
