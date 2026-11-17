/**
 * IPC for Home's Waiting tab: read the news not yet told and the news Scout gave up on. It goes
 * through the brain's Home tool events_waiting; the brain owns the events. Contains
 * registerEventsIpc.
 */

import { parseEventsWaiting } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

export function registerEventsIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.eventsWaiting, async () =>
    parseEventsWaiting(await callJson(brain, 'events_waiting')),
  );
}
