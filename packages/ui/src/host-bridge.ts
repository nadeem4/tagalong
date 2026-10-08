import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import type {
  ActivityListResult,
  ContextSnapshot,
  CoreToHostNotification,
  NotificationParamsOf,
  PerceptionTarget,
  Pet,
  Role,
  RolesUpgradeNotice,
} from '@tagalong/protocol';

/**
 * The core-to-host notifications a panel renders: everything about a turn in flight, plus
 * the crew's own — one pet addressing another, and a crew run's progress.
 */
type TurnNotification =
  | Extract<CoreToHostNotification, `turn.${string}`>
  | 'pet.message'
  | 'crew.status'
  | 'watch.fired'
  | 'watch.status';

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
  /** Phase 8. Every role in the engine's library: the office labels and the role picker. */
  listRoles(): Promise<Role[]>;
  /**
   * Phase 8. The model a pet with this role would start on, on this provider, for a form to
   * prefill. Both fields are absent when the provider has no tier table, such as `fake`.
   */
  recommendModel(
    roleId: string,
    providerId: string,
  ): Promise<{ model?: string; visionModel?: string }>;
  /**
   * Phase 8. What the upgrade to roles did to this install, while the one-time notice is
   * unseen; null once dismissed, and always null on a fresh install.
   */
  rolesNotice(): Promise<RolesUpgradeNotice | null>;
  /** Phase 8. Marks the roles notice seen, so no window shows it again. */
  dismissRolesNotice(): Promise<void>;
  /**
   * Phase 3B. Ends a watch from its Watching chip. Optional: a host that cannot start
   * watches never shows a chip to stop.
   */
  stopWatch?(watchId: string): Promise<void>;
  /**
   * Home. What the crew did — turns, consults, handoffs, roundtables — newest first, a page
   * at a time (`before` is the previous page's `next`). Optional: a host without Home never
   * shows the activity view.
   */
  listActivity?(params?: { before?: string; limit?: number }): Promise<ActivityListResult>;
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
