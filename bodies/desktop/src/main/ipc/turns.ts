/**
 * IPC for asking and interrupting: both go to the brain over contract v1. A remark's Not now
 * is kept as a no-op, since the brain has nothing to tell. Contains registerTurnIpc.
 */

import type { Part, SayParams } from '@tagalong/contract';
import { STATUS_WORDS } from '@tagalong/protocol';
import type { ContextSnapshot, Dropped } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import { BrainOffline } from '@tagalong/contract';
import type { BrainClient, BrainStatus } from '@tagalong/contract';
import type { IpcHandle } from './handle';

export interface TurnIpcDeps {
  brain: Pick<BrainClient, 'say' | 'cancel'>;
  /** Makes a turn the question joined visible, when the brain started it on its own. */
  claimTurn: (turnId: string) => void;
  /** The link as last reported; a too-new brain gets the update words, not the offline ones. */
  status: () => BrainStatus;
  /** The snapshot the last hotkey captured, sent with the ask. */
  pendingSnapshot: () => ContextSnapshot | null;
  /**
   * Reads the item last dropped on Scout, once, for an ask from a drop card's button.
   * Rejects with the sentence to show when it cannot be read.
   */
  takeDrop?: () => Promise<Dropped>;
}

/** What a dropped item adds to the ask, as parts. */
function droppedParts(dropped: Dropped): Part[] {
  const parts: Part[] = [];
  const text = [dropped.name, dropped.text].filter((s) => s !== undefined).join('\n\n');
  if (text !== '') parts.push({ type: 'text', text });
  if (dropped.image) {
    parts.push({ type: 'image', mime: dropped.image.mime, data: dropped.image.base64 });
  }
  return parts;
}

export function registerTurnIpc(handle: IpcHandle, deps: TurnIpcDeps): void {
  handle(
    IPC.ask,
    async (
      _event,
      input: {
        petId: string;
        conversationId?: string;
        text?: string;
        spoken?: boolean;
        drop?: boolean;
      },
    ) => {
      const snapshot = deps.pendingSnapshot();
      // Only a drop card's button sends the dropped item, and it is read only now.
      const dropped = input.drop === true && deps.takeDrop ? await deps.takeDrop() : null;
      const parts: Part[] = [];
      if (snapshot?.screenshot) {
        parts.push({
          type: 'image',
          mime: snapshot.screenshot.mime,
          data: snapshot.screenshot.base64,
        });
      }
      if (dropped !== null) parts.push(...droppedParts(dropped));
      const windowTitle = snapshot?.app?.windowTitle;
      const say: SayParams = {
        text: input.text ?? '',
        ...(parts.length > 0 ? { parts } : {}),
        ...(windowTitle !== undefined ? { context: { window: windowTitle } } : {}),
        ...(input.spoken === true ? { spoken: true } : {}),
      };
      try {
        const said = await deps.brain.say(say);
        // The question joined a running turn; if that was a quiet wake, it shows from now on.
        if (said.joined) deps.claimTurn(said.turn);
        return { turnId: said.turn };
      } catch (error) {
        // The desktop's own words, never the brain's message.
        if (error instanceof BrainOffline) {
          const words = deps.status() === 'outdated' ? 'brain-outdated' : 'brain-offline';
          throw new Error(STATUS_WORDS[words].detail, { cause: error });
        }
        throw error;
      }
    },
  );

  handle(IPC.interrupt, (_event, turnId: string) => {
    deps.brain.cancel(turnId);
  });

  handle(IPC.remarkNotNow, () => undefined);
}
