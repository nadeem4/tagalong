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
  ContextSnapshot,
  CoreToHostNotification,
  NotificationParamsOf,
  PerceptionTarget,
  Pet,
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
 * (`auto`). A locked tool asks until set to auto on Home; an offline body's tool cannot be changed yet.
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
 * The notifications a panel renders: everything about a turn in flight, the brain's asks
 * (shown as confirm cards) and Scout's own words from a wake.
 */
type TurnNotification =
  | Extract<CoreToHostNotification, `turn.${string}`>
  | 'connector.confirm'
  | 'connector.dismiss'
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
  /** The person's answer to a confirm card: run it once, always allow the tool, or deny it. */
  approveTool?(approvalId: string, decision: 'once' | 'always' | 'deny'): Promise<void>;
  /**
   * The answer to a Claude Code job's ask: one of its own option names, or typed text for a
   * question. Separate from approveTool because these options are not allow/always/deny.
   */
  answerJobAsk?(approvalId: string, answer: { option: string; text?: string }): Promise<void>;
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
