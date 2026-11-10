/**
 * IPC for Home's Timers tab: list the timers and cancel one. Both go through the brain's Home
 * tools (timers_state, timer_cancel); the brain owns the timers, the page is not trusted, so
 * the id is checked before the brain hears of it. Contains registerTimersIpc.
 */

import { parseTimersState } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

const Id = z.string().min(1);

export function registerTimersIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.timersState, async () => parseTimersState(await callJson(brain, 'timers_state')));
  handle(IPC.timersCancel, async (_event, id: unknown) => {
    await callJson(brain, 'timer_cancel', { id: Id.parse(id) });
  });
}
