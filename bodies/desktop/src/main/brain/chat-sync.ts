/**
 * Keeps the desktop's place in the brain's saved chat. The id of the newest saved reply is
 * refreshed when the link comes up and after each turn, so after a resync (a reply too long for
 * the replay window) the catch-up asks only for what came after it, a page at a time, and a
 * reply shown live is never shown again. No clocks are compared. Contains createChatSync.
 */
import { z } from 'zod';
import type { TurnEvent } from '@tagalong/ui/shapes';
import type { createTurnEvents } from './turn-events';

const Saved = z.object({
  messages: z.array(
    z.object({ id: z.string(), role: z.string(), text: z.string(), body: z.string() }),
  ),
  more: z.boolean().optional(),
});

interface ChatSyncDeps {
  /** Runs the brain's Home tool and returns its parsed answer. */
  call: (tool: string, input: Record<string, unknown>) => Promise<unknown>;
  events: ReturnType<typeof createTurnEvents>;
  forward: (event: TurnEvent) => void;
}

export function createChatSync({ call, events, forward }: ChatSyncDeps) {
  let pending = false;
  // One call chain at a time, so a refresh never lands between two pages of a catch-up.
  let chain: Promise<void> = Promise.resolve();

  const page = async (input: Record<string, unknown>) =>
    Saved.parse(await call('chat_since', input));

  async function run(): Promise<void> {
    try {
      if (!pending) {
        events.seen((await page({ limit: 1 })).messages);
        return;
      }
      for (;;) {
        const anchor = events.chatAnchor();
        const answer = await page(anchor === undefined ? {} : { after_id: anchor });
        events.caughtUp(answer.messages).forEach(forward);
        if (answer.more !== true || answer.messages.length === 0) break;
      }
      pending = false; // only now: a failed page leaves the catch-up for the next online
    } catch (error) {
      console.warn(`reading the saved chat failed: ${String(error)}`);
    }
  }

  const queue = (): Promise<void> => {
    chain = chain.then(run);
    return chain;
  };

  return {
    /** The brain said resync: the next online catches up. */
    resynced(): void {
      pending = true;
    },
    /** The link is up: catch up if a resync is pending, else refresh the anchor. */
    online: queue,
    /** A turn ended: the reply it streamed is on screen, so the anchor moves past it. */
    turnEnded: queue,
  };
}
