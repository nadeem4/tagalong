import type { ContextSnapshot, PerceptionTarget, Pet } from '@tagalong/protocol';
import type { AskInput, HostBridge, TurnEvent } from '../host-bridge';

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
}

/**
 * Shipped from the package rather than kept in test files: the desktop host needs the
 * same bridge double to test its renderer without booting an engine.
 */
export function createFakeHostBridge(
  options: { pets?: Pet[]; capture?: ContextSnapshot | null } = {},
): FakeHostBridge {
  const handlers = new Set<(event: TurnEvent) => void>();
  const asks: AskInput[] = [];
  const interrupts: string[] = [];
  const stoppedWatches: string[] = [];
  const captures: (readonly PerceptionTarget[])[] = [];
  let turnCount = 0;

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
    emit(event) {
      // Copied first so a handler that unsubscribes mid-emit cannot skip its neighbours.
      for (const handler of [...handlers]) {
        handler(event);
      }
    },
  };

  return fake;
}
