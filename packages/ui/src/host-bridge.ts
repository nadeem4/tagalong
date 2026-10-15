import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import type {
  ActivityListResult,
  Brief,
  ConnectionState,
  ConnectionsAddParams,
  ConnectionsListResult,
  ContextSnapshot,
  CoreToHostNotification,
  Expert,
  NotificationParamsOf,
  PerceptionTarget,
  Pet,
  ProjectCandidate,
  RoutineDraftInput,
  RoutineProposedParams,
  RoutineView,
  SightLogEntry,
} from '@tagalong/protocol';

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
  | 'routine.proposed'
  | 'routine.result'
  | 'routines.changed'
  | 'connections.changed'
  | 'pet.mood';

/**
 * Derived from the protocol catalog rather than restated, so a new turn.* notification
 * lands in the UI as a compile error instead of a silently ignored event.
 */
export type TurnEvent = {
  [N in TurnNotification]: { type: N } & NotificationParamsOf<N>;
}[TurnNotification];

export interface AskInput {
  petId: string;
  /** The conversation to continue. Absent opens a new one; turn.started reports its id. */
  conversationId?: string;
  text?: string;
  snapshot?: ContextSnapshot;
  /** The question was spoken (Talk to Scout): Scout answers the way a person talks. */
  spoken?: boolean;
}

/**
 * Everything this package is allowed to know about the outside world. Each host —
 * Electron today, the browser extension later — implements it; the components never
 * touch a socket, a preload bridge, or a node API themselves.
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
   * Phase 3B. Ends a watch from its Watching chip. Optional: a host that cannot start
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
   * Home's Experts tab: the tools a companion hands work to. All optional: a host without
   * Home, such as the browser extension, never shows the tab.
   */
  listExperts?(): Promise<Expert[]>;
  saveExpert?(expert: Expert): Promise<Expert>;
  deleteExpert?(expertId: string): Promise<boolean>;
  /** Whether the expert can be reached, at no cost: Claude Code's `--version`. */
  testExpert?(expertId: string): Promise<{ ok: boolean; error?: string }>;
  /** The host's folder picker; null when the user cancelled. */
  pickFolder?(): Promise<string | null>;
  /** Sends a proposed hand-off, in the folder the person settled on. */
  confirmHandoff?(params: ConfirmHandoff): Promise<{ handoffId: string }>;
  dismissHandoff?(proposalId: string): Promise<void>;
  cancelHandoff?(handoffId: string): Promise<void>;
  /** Projects on this computer matching a name or path, for "Change project". */
  searchProjects?(query: string): Promise<ProjectCandidate[]>;
  /** The person's answer to a connector confirm card: run it once, or cancel it. */
  approveTool?(approvalId: string, decision: 'once' | 'deny'): Promise<void>;
  /**
   * Home's Connections page: the person's apps over MCP, the Popular list and the servers
   * found in Claude Code. All optional: a host without Home never shows the page.
   */
  listConnections?(): Promise<ConnectionsListResult>;
  addConnection?(params: ConnectionsAddParams): Promise<ConnectionState>;
  setConnectionEnabled?(id: string, enabled: boolean): Promise<ConnectionState>;
  signInConnection?(id: string): Promise<ConnectionState>;
  /** Disconnect: tokens and keys deleted, the connection forgotten. */
  removeConnection?(id: string): Promise<boolean>;
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
   * Home's What Scout saw: each look and each send, newest first, as metadata. All
   * optional: a host without Home never shows the page.
   */
  listSightLog?(): Promise<SightLogEntry[]>;
  deleteSightLog?(id: string): Promise<boolean>;
  /** Deletes the whole log; resolves to how many rows went. */
  clearSightLog?(): Promise<number>;
}

export interface ConfirmHandoff {
  proposalId: string;
  folder: string;
  canEdit: boolean;
  brief?: Brief;
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
