/**
 * IPC for Home's "Read my mail for loops" card: read the state (switches and the Held list),
 * switch an app on or off, forget one loop, stop and wipe. All go through the brain's Home tools
 * (loops_state, loops_set, loop_forget, loops_wipe); the brain owns the loops and the consent,
 * the page is not trusted, so arguments are checked before the brain hears of them.
 * Contains registerLoopsIpc.
 */

import { parseLoopsState } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

const Id = z.string().min(1);

export function registerLoopsIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.loopsState, async () => parseLoopsState(await callJson(brain, 'loops_state')));
  handle(IPC.loopsSet, async (_event, app: unknown, on: unknown) => {
    await callJson(brain, 'loops_set', { app: Id.parse(app), on: z.boolean().parse(on) });
  });
  handle(IPC.loopForget, async (_event, id: unknown) => {
    await callJson(brain, 'loop_forget', { id: Id.parse(id) });
  });
  handle(IPC.loopsWipe, async () => {
    await callJson(brain, 'loops_wipe');
  });
}
