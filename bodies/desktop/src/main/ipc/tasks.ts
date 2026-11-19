/**
 * IPC for Home's task list: read every task that is not an Ask, ended ones too, through the
 * brain's Home tool tasks_list; the brain owns the tasks. Contains registerTasksIpc.
 */

import { parseTasksList } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

export function registerTasksIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.tasksList, async () =>
    parseTasksList(await callJson(brain, 'tasks_list', { include_ended: true })),
  );
}
