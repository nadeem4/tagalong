import type { Pet } from '@tagalong/protocol';
import type { AskInput, HostBridge, TurnEvent } from '../host-bridge';

export interface FakeHostBridge extends HostBridge {
  /** Delivers an event to every subscriber synchronously, so tests need no timers. */
  emit(event: TurnEvent): void;
  readonly asks: readonly AskInput[];
  readonly interrupts: readonly string[];
}

/**
 * Shipped from the package rather than kept in test files: the desktop host needs the
 * same bridge double to test its renderer without booting an engine.
 */
export function createFakeHostBridge(options: { pets?: Pet[] } = {}): FakeHostBridge {
  const handlers = new Set<(event: TurnEvent) => void>();
  const asks: AskInput[] = [];
  const interrupts: string[] = [];
  let turnCount = 0;

  return {
    asks,
    interrupts,
    ask(input) {
      asks.push(input);
      turnCount += 1;
      return Promise.resolve({ turnId: `turn-${turnCount}` });
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
    emit(event) {
      // Copied first so a handler that unsubscribes mid-emit cannot skip its neighbours.
      for (const handler of [...handlers]) {
        handler(event);
      }
    },
  };
}
