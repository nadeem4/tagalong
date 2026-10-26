/**
 * IPC for asking and interrupting: both go to the brain over contract v1. Stopping a watch
 * and a remark's two buttons are kept as no-ops until the brain has them. Contains
 * registerTurnIpc.
 */

import type { Part, SayParams } from '@tagalong/contract';
import { STATUS_WORDS } from '@tagalong/protocol';
import type { ContextSnapshot, Dropped } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import { BrainOffline } from '../brain/brain-client';
import type { BrainClient } from '../brain/brain-client';
import type { IpcHandle } from './handle';

export interface TurnIpcDeps {
  brain: Pick<BrainClient, 'say' | 'cancel'>;
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
        return { turnId: (await deps.brain.say(say)).turn };
      } catch (error) {
        // The desktop's own words, never the brain's message.
        if (error instanceof BrainOffline)
          throw new Error(STATUS_WORDS['brain-offline'].detail, { cause: error });
        throw error;
      }
    },
  );

  handle(IPC.stopWatch, () => undefined);

  handle(IPC.interrupt, (_event, turnId: string) => {
    deps.brain.cancel(turnId);
  });

  handle(IPC.remarkNotNow, () => undefined);
  handle(IPC.remarkAccept, () => undefined);
}
