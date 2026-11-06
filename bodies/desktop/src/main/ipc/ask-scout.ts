/**
 * IPC for "Ask Scout to fix it" on Home: main brings the companion's bubble up and hands it the
 * text, which the bubble then asks as if the person typed it (so Scout's usual ask still
 * gates anything it does). Only Home's page may call it, and only non-empty text goes on.
 * Contains registerAskScoutIpc.
 */

import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

const Text = z.string().trim().min(1);

export function registerAskScoutIpc(
  handle: IpcHandle,
  deps: {
    /** Whether the call came from Home's own page: no other window may speak as the person. */
    fromHome: (event: unknown) => boolean;
    bringUp: () => void;
    send: (text: string) => void;
  },
): void {
  handle(IPC.askScout, (event, text: unknown) => {
    if (!deps.fromHome(event)) return;
    const parsed = Text.safeParse(text);
    if (!parsed.success) return;
    deps.bringUp();
    deps.send(parsed.data);
  });
}
