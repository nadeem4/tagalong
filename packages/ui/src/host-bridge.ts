import { createContext, createElement, useContext } from 'react';
import type { ReactNode } from 'react';
import type {
  ContextSnapshot,
  CoreToHostNotification,
  NotificationParamsOf,
  PerceptionTarget,
  Pet,
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
  /**
   * Phase 3B. Ends a watch from its Watching chip. Optional: a host that cannot start
   * watches never shows a chip to stop.
   */
  stopWatch?(watchId: string): Promise<void>;
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
