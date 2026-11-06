/**
 * IPC for "Ask Scout to fix it" on Home: main brings the companion's bubble up and hands it the
 * text, which the bubble then asks as if the person typed it (so Scout's usual ask still
 * gates anything it does). The page is not trusted: only non-empty text goes on.
 * Contains registerAskScoutIpc.
 */

import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

const Text = z.string().trim().min(1);

export function registerAskScoutIpc(
  handle: IpcHandle,
  deps: { bringUp: () => void; send: (text: string) => void },
): void {
  handle(IPC.askScout, (_event, text: unknown) => {
    const parsed = Text.safeParse(text);
    if (!parsed.success) return;
    deps.bringUp();
    deps.send(parsed.data);
  });
}
