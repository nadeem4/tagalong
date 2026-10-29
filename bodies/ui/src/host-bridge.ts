/**
 * The HostBridge contract: every call and notification a ui component may use, which each
 * host (the Electron app, the browser extension) implements. Contains HostBridge, TurnEvent,
 * AskInput, ConfirmHandoff, and the HostBridgeProvider / useHostBridge React context.
 */

import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import type {
  AppAddParams,
  AppsList,
  CalendarCheckResult,
  ActivityListResult,
  AsksListResult,
  ExperienceGetResult,
  ExperienceListResult,
  SelfGetResult,
  SelfListResult,
  Brief,
  ContextSnapshot,
  CoreToHostNotification,
  CatalogStatus,
  Expert,
  NotificationParamsOf,
  PerceptionTarget,
  Pet,
  ProjectCandidate,
  RoutineDraftInput,
  RoutineProposedParams,
  RoutineView,
  SettingsPatch,
  SightLogEntry,
  MemoryEntry,
} from '@tagalong/protocol';
import type { FixTarget, HealthFacts } from './health';

/** What the brain knows of spend: today's dollars and the daily limit (null when it has none). */
export interface SpendToday {
  spentUsd: number;
  limitUsd: number | null;
}

/**
 * One tool in Home's Permissions list: whether Scout asks before using it (`ask`) or just does
 * (`auto`). A locked tool always asks; an offline body's tool cannot be changed yet.
 */
export interface PermissionRow {
  name: string;
  description: string;
  effect: 'read' | 'change';
  mode: 'ask' | 'auto';
  locked: boolean;
  /** The tool opens its own ask with the person, so the switch changes nothing (brain's flag). */
  self_asks?: boolean;
  online: boolean;
}

/** One Claude Code job in Home's Jobs panel, as the brain's list_jobs sends it. */
export interface JobRow {
  id: string;
  agent: string;
  task: string;
  folder: string;
  mode: string;
  state: string;
  reason: string | null;
  progress: string | null;
  result: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** One permission decision in Home's Approvals history, as the brain's list_approvals sends it. */
export interface ApprovalRow {
  id: number;
  source: 'scout_tool' | 'claude_code' | 'app';
  tool: string;
  summary: string;
  outcome: 'approved' | 'refused' | 'timed_out' | 'no_one';
  decidedBy: 'person' | 'scout' | 'none';
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
}

/**
 * The core-to-host notifications a panel renders: everything about a turn in flight, a
 * watch, a hand-off to an expert as it goes, connector confirms and routines.
 */
type TurnNotification =
  | Extract<CoreToHostNotification, `turn.${string}`>
  | 'watch.fired'
  | 'watch.status'
  | 'handoff.proposed'
  | 'handoff.progress'
  | 'handoff.finished'
  | 'connector.confirm'
  | 'connector.dismiss'
  | 'asks.changed'
  | 'routine.proposed'
  | 'routine.result'
  | 'routines.changed'
  | 'pet.mood'
  | 'settings.proposed'
  // Only the line about a finished hand-off (with `handoffId`); other lines show beside Scout.
  | 'pet.remark';

/**
 * Derived from the protocol catalog rather than restated, so a new turn.* notification
 * lands in the UI as a compile error instead of a silently ignored event.
 */
export type TurnEvent =
  | {
      [N in TurnNotification]: { type: N } & NotificationParamsOf<N>;
    }[TurnNotification]
  // The brain only says the apps changed; the page reads the list again. The old engine's
  // payload (packages/core) is not part of the bodies' contract.
  | { type: 'connections.changed' };

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
}

/**
 * Everything this package is allowed to know about the outside world. The desktop app and
 * the browser extension each implement it; the components never touch a socket, a preload
 * bridge or a node API themselves.
 */
export interface HostBridge {
  ask(input: AskInput): Promise<{ turnId: string }>;
  /**
   * Perceives the screen now, on the user's click. Resolves to null when the host
   * refused — an excluded window — so the panel can say capture is blocked here
   * instead of silently staying blind.
   */
  capture(targets: readonly PerceptionTarget[]): Promise<ContextSnapshot | null>;
  interrupt(turnId: string): Promise<void>;
  /** Returns an unsubscribe function. */
  onTurnEvent(handler: (event: TurnEvent) => void): () => void;
  listPets(): Promise<Pet[]>;
  /**
   * Ends a watch from its Watching chip. Optional: a host that cannot start
   * watches never shows a chip to stop.
   */
  stopWatch?(watchId: string): Promise<void>;
  /**
   * Home. What Scout did — turns, hand-offs to experts, app calls, routines — newest first, a page
   * at a time (`before` is the previous page's `next`). Optional: a host without Home never
   * shows the activity view.
   */
  listActivity?(params?: { before?: string; limit?: number }): Promise<ActivityListResult>;
  /**
   * Home's decisions page: the experience log, every turn and check-in with what Scout was
   * shown, what it decided and what came of it, newest first, a page at a time. Optional, like
   * the activity view.
   */
  listExperience?(params?: { before?: string; limit?: number }): Promise<ExperienceListResult>;
  /** One episode with its tool calls and outcomes, or null once it is gone. */
  getExperience?(id: string): Promise<ExperienceGetResult>;
  /** Delete all: every decision and its steps. Resolves with how many went. */
  clearExperience?(): Promise<number>;
  /**
   * Home's What Scout learned: Scout's own notes (the Self), their versions, the person's
   * edits and undo. Optional, like the activity view.
   */
  listSelf?(): Promise<SelfListResult>;
  getSelf?(path: string): Promise<SelfGetResult>;
  writeSelf?(path: string, text: string): Promise<{ ok: boolean; reason?: string; note?: string }>;
  undoSelf?(versionId: number): Promise<{ ok: boolean; reason?: string }>;
  /** A proposed change: accepted applies it, rejected keeps it on record, never applied. */
  acceptSelf?(versionId: number): Promise<{ ok: boolean; reason?: string }>;
  rejectSelf?(versionId: number): Promise<{ ok: boolean; reason?: string }>;
  /**
   * Home's Experts page: the tools a companion hands work to. All optional: a host without
   * Home, such as the browser extension, never shows the page.
   */
  listExperts?(): Promise<Expert[]>;
  saveExpert?(expert: Expert): Promise<Expert>;
  deleteExpert?(expertId: string): Promise<boolean>;
  /** Whether the expert can be reached, at no cost: Claude Code's `--version`. */
  testExpert?(expertId: string): Promise<{ ok: boolean; error?: string }>;
  /** The built-in expert catalog, with what this computer has for each entry. */
  expertCatalog?(): Promise<CatalogStatus[]>;
  /** Installs an entry's missing plugins with `claude plugin install`, on the person's press. */
  installExpert?(catalogId: string): Promise<{ ok: boolean; installed: string[]; error?: string }>;
  /** The host's folder picker; null when the user cancelled. */
  pickFolder?(): Promise<string | null>;
  /** Sends a proposed hand-off, in the folder the person settled on. */
  confirmHandoff?(params: ConfirmHandoff): Promise<{ handoffId: string }>;
  dismissHandoff?(proposalId: string): Promise<void>;
  cancelHandoff?(handoffId: string): Promise<void>;
  /** Projects on this computer matching a name or path, for "Change project". */
  searchProjects?(query: string): Promise<ProjectCandidate[]>;
  /** The person's answer to a confirm card: run it once, always allow the tool, or deny it. */
  approveTool?(approvalId: string, decision: 'once' | 'always' | 'deny'): Promise<void>;
  /**
   * The answer to a Claude Code job's ask: one of its own option names, or typed text for a
   * question. Separate from approveTool because these options are not allow/always/deny.
   */
  answerJobAsk?(approvalId: string, answer: { option: string; text?: string }): Promise<void>;
  /**
   * Home's Waiting on you: what waits on the person and the last answered. Allow once and
   * Decline answer an ask (resolves false when it no longer waited); Open brings a hand-off
   * card up again in the bubble. All optional: a host without Home never shows the page.
   */
  listAsks?(): Promise<AsksListResult>;
  answerAsk?(id: string, decision: 'approve' | 'decline'): Promise<boolean>;
  openAsk?(id: string): Promise<boolean>;
  /**
   * Home's Connections page: the apps the brain keeps (MCP). All optional: a host without
   * Home never shows the page. They reject with "brain offline" while the brain is away.
   * Only `listConnections` and `addConnection` have answers worth reading; the page lists again
   * after the rest.
   */
  listConnections?(): Promise<AppsList>;
  addConnection?(params: AppAddParams): Promise<{ id: string }>;
  setConnectionEnabled?(id: string, enabled: boolean): Promise<unknown>;
  restartConnection?(id: string): Promise<unknown>;
  /** Opens the app's sign-in in the browser on the brain's machine; the outcome arrives as `connections.changed`. */
  signInConnection?(id: string): Promise<unknown>;
  /** Remove: the brain forgets the app and deletes its stored key. */
  removeConnection?(id: string): Promise<unknown>;
  /**
   * Home's Routines page and the routine card. All optional: a host without Home never shows
   * either. Saving, in Home or on the card, is the person's consent.
   */
  listRoutines?(): Promise<RoutineView[]>;
  saveRoutine?(routine: RoutineDraftInput & { id?: string }): Promise<RoutineView>;
  deleteRoutine?(id: string): Promise<boolean>;
  setRoutineEnabled?(id: string, enabled: boolean): Promise<RoutineView>;
  /** Runs it once now; the result arrives as `routine.result`. */
  runRoutine?(id: string): Promise<boolean>;
  /** Save on Scout's card, with the person's edit when there is one. */
  confirmRoutine?(
    proposalId: string,
    routine?: RoutineDraftInput,
  ): Promise<{ routine?: RoutineView; deleted?: boolean }>;
  dismissRoutine?(proposalId: string): Promise<void>;
  /** Edit on Scout's card: Home opens on Routines with the card's routine in the form. */
  editRoutine?(proposal: RoutineProposedParams): Promise<void>;
  /**
   * Pick up where you left off. Open reopens one project of the current pick-up, by item id:
   * the host opens only what that pick-up named. Brief again puts a saved ask on the hand-off
   * card, unsent. Not now drops the offer. All optional: a host without it never shows the card.
   */
  openPickUp?(itemId: string): Promise<void>;
  rebriefPickUp?(itemId: string): Promise<void>;
  dismissPickUp?(): Promise<void>;
  /**
   * Home's What Scout saw: each look and each send, newest first, as metadata. All
   * optional: a host without Home never shows the page.
   */
  listSightLog?(): Promise<SightLogEntry[]>;
  deleteSightLog?(id: string): Promise<boolean>;
  /** Deletes the whole log; resolves to how many rows went. */
  clearSightLog?(): Promise<number>;
  /**
   * Home's What Scout remembers: its facts, preferences and summaries, newest first, each
   * deletable. Optional: a host without Home never shows the page.
   */
  listMemories?(): Promise<MemoryEntry[]>;
  deleteMemory?(id: string): Promise<boolean>;
  /**
   * Draft it for me: puts a draft on the clipboard, on the person's Copy click only. It
   * never reads the clipboard and never pastes. Optional: without it a draft has no Copy.
   */
  copyText?(text: string): Promise<void>;
  /**
   * Meeting prep's .ics link, kept in the keychain by the engine (null forgets it). The
   * answer says whether it reads, and never holds the link.
   */
  setCalendarLink?(link: string | null): Promise<CalendarCheckResult>;
  /** Whether a calendar link is kept, without showing it. */
  checkCalendar?(): Promise<CalendarCheckResult>;
  /** Home's Spend card: what was spent today and the daily limit, as the brain knows them. */
  usageSummary?(): Promise<SpendToday>;
  /** Home's Permissions: each tool Scout can use and whether it asks first. */
  listPermissions?(): Promise<PermissionRow[]>;
  /** Sets one tool to ask or auto; rejects when the brain refuses (a locked tool, say). */
  setPermission?(tool: string, mode: 'ask' | 'auto'): Promise<void>;
  /** Home's Jobs panel: recent Claude Code jobs, newest first. */
  listJobs?(): Promise<JobRow[]>;
  /** Stops one running job; rejects when the brain refuses (already ended, say). */
  stopJob?(job: string): Promise<void>;
  /** Home's Approvals history, newest first; `before` is the `next` cursor of the page above. */
  listApprovals?(
    filter: 'all' | 'scout' | 'refused',
    before?: number,
  ): Promise<{ approvals: ApprovalRow[]; counts: ApprovalCounts; next: number | null }>;
  /** The preferences Scout follows, the built-in one included. */
  listPreferences?(): Promise<PreferenceRow[]>;
  /** Removes a preference; rejects when the brain refuses (already gone, say). */
  removePreference?(id: number): Promise<void>;
  /** Rewrites a preference's sentence; rejects when the brain refuses it. */
  editPreference?(id: number, sentence: string): Promise<void>;
  /** Scout approved an ask under a preference: tell the person once. Returns an unsubscribe. */
  onApproved?(
    handler: (n: { tool: string; text: string; preference: string; cameUp?: boolean }) => void,
  ): () => void;
  /** Home's "Where things run": the brain's address and link status. Optional: no brain, no card. */
  brainLink?(): Promise<BrainLink>;
  /**
   * The brain changed something Home shows (`memory`, `permissions`; `link` when the connection
   * to the brain goes up or down): read it again. Returns an
   * unsubscribe function. Optional: a host without a brain never sends it.
   */
  onBrainChanged?(handler: (what: string) => void): () => void;
  /**
   * "Scout, what's wrong?": what the health card reads, from calls the host already makes.
   * No model call, so it works when Scout cannot think. Never a key or a secret.
   */
  checkHealth?(): Promise<HealthFacts>;
  /** A health card's Fix it: opens the Settings section or Home page that fixes it. */
  openFix?(target: FixTarget): Promise<void>;
  /** The health card's Open logs folder: shows the folder; no log text leaves the host. */
  openLogs?(): Promise<void>;
  /**
   * Apply on Scout's settings card: saves the card's patch through the host's ordinary
   * settings path, on the person's click only. Optional: without it the card cannot apply.
   */
  applySettings?(patch: SettingsPatch): Promise<void>;
}

export interface ConfirmHandoff {
  proposalId: string;
  /** Left out for an expert that works in its own folder. */
  folder?: string;
  canEdit: boolean;
  brief?: Brief;
  /** A two-step hand-off: step 2's access and edited ask, or null when it was removed. */
  then?: { canEdit: boolean; ask?: string } | null;
}

const HostBridgeContext = createContext<HostBridge | null>(null);

export interface HostBridgeProviderProps {
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
