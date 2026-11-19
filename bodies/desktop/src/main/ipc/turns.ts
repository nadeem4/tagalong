/**
 * IPC for asking and interrupting: both go to the brain over contract v2. An ask carries the
 * window title and the selected text (capped) as its context. Contains registerTurnIpc.
 */

import type { Part, SayParams } from '@tagalong/contract';
import { STATUS_WORDS } from '@tagalong/ui/shapes';
import type { ContextSnapshot, Dropped } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { BrainOffline } from '@tagalong/contract';
import type { BrainClient, BrainStatus } from '@tagalong/contract';
import type { IpcHandle } from './handle';

interface TurnIpcDeps {
  brain: Pick<BrainClient, 'say' | 'cancel'>;
  /** Tells the turn mapper a say id is ours, so the turn that takes it shows. */
  trackSay: (id: string) => void;
  /** Forgets a say id the brain never accepted. */
  untrackSay: (id: string) => void;
  /** The link as last reported; a too-new brain gets the update words, not the offline ones. */
  status: () => BrainStatus;
  /** Stops Scout's speech everywhere: a cancelled turn does not hush its own. */
  stopVoice: () => void;
  /** Scout talks: on or off, how fast. Rides on each spoken ask. */
  voice: () => { enabled: boolean; speed: number };
  /** The snapshot the last hotkey captured, sent with the ask. */
  pendingSnapshot: () => ContextSnapshot | null;
  /** Drops the snapshot's selection once an ask has sent it: it goes with one ask only. */
  clearSelection: () => void;
  /**
   * Reads the item last dropped on Scout, once, for an ask from a drop card's button.
   * Rejects with the sentence to show when it cannot be read.
   */
  takeDrop?: () => Promise<Dropped>;
}

/** The most selected text an ask carries; a longer one is cut and ends with CUT_MARK. */
export const ASK_SELECTION_MAX_CHARS = 4000;
const CUT_MARK = '…[cut]';

/** Cut to the cap without leaving half a surrogate pair, and say so. */
function capSelection(text: string): string {
  if (text.length <= ASK_SELECTION_MAX_CHARS) return text;
  const last = text.charCodeAt(ASK_SELECTION_MAX_CHARS - 1);
  const end =
    last >= 0xd800 && last <= 0xdbff ? ASK_SELECTION_MAX_CHARS - 1 : ASK_SELECTION_MAX_CHARS;
  return text.slice(0, end) + CUT_MARK;
}

/** The context an ask sends: each key only when present, nothing when neither is. */
function askContext(snapshot: ContextSnapshot | null): SayParams['context'] | undefined {
  const window = snapshot?.app?.windowTitle;
  const selection = snapshot?.selection;
  const context: Record<string, string> = {};
  if (window !== undefined) context.window = window;
  if (selection !== undefined) context.selection = capSelection(selection);
  return Object.keys(context).length > 0 ? context : undefined;
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
        /** The person spoke over this turn after hearing `heard` of its sentences. */
        interrupted?: { turn: string; heard: number };
      },
    ) => {
      const snapshot = deps.pendingSnapshot();
      // Only a drop card's button sends the dropped item, and it is read only now.
      const dropped = input.drop === true && deps.takeDrop ? await deps.takeDrop() : null;
      const parts: Part[] = [];
      if (dropped !== null) parts.push(...droppedParts(dropped));
      const context = askContext(snapshot);
      const voice = deps.voice();
      const spoken = input.spoken === true && voice.enabled;
      const say: SayParams = {
        id: crypto.randomUUID(),
        text: input.text ?? '',
        ...(parts.length > 0 ? { parts } : {}),
        ...(context !== undefined ? { context } : {}),
        ...(spoken ? { spoken: true, speed: voice.speed } : {}),
        ...(input.interrupted !== undefined ? { interrupted: input.interrupted } : {}),
      };
      deps.clearSelection();
      try {
        // Tracked before it is sent: the brain's turn frames can beat its answer.
        deps.trackSay(say.id);
        await deps.brain.say(say);
      } catch (error) {
        deps.untrackSay(say.id);
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
    deps.stopVoice();
  });
}
