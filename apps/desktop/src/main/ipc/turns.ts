import type { ContextSnapshot } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

export interface TurnIpcDeps {
  /** Throws when the engine is not running: a turn needs the engine that runs it. */
  engine: () => EngineCall;
  /** The engine when it is running; null when it is not. */
  maybeEngine: () => EngineCall | null;
  /** The snapshot the last hotkey captured, sent with the ask. */
  pendingSnapshot: () => ContextSnapshot | null;
}

/** Asking, stopping and interrupting turns, and a remark's two buttons. */
export function registerTurnIpc(handle: IpcHandle, deps: TurnIpcDeps): void {
  const { engine } = deps;

  handle(
    IPC.ask,
    async (
      _event,
      input: { petId: string; conversationId?: string; text?: string; spoken?: boolean },
    ) => {
      const snapshot = deps.pendingSnapshot();
      return engine().call('ask', {
        petId: input.petId,
        ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
        input: { text: input.text ?? '' },
        ...(snapshot !== null ? { snapshot } : {}),
        ...(input.spoken === true ? { spoken: true } : {}),
      });
    },
  );

  handle(IPC.stopWatch, async (_event, watchId: string) => {
    await engine().call('watch.stop', { watchId });
  });

  handle(IPC.interrupt, async (_event, turnId: string) => {
    await engine().call('interrupt', { turnId });
  });

  // A remark's two buttons. Not now quiets Scout for an hour; taking the offer sends its
  // brief to the hand-off card, where nothing runs until the person presses Send.
  handle(IPC.remarkNotNow, async () => {
    await deps.maybeEngine()?.call('keepAnEye.notNow', {});
  });
  handle(IPC.remarkAccept, async (_event, remarkId: string) => {
    await deps.maybeEngine()?.call('keepAnEye.accept', { remarkId });
  });
}
