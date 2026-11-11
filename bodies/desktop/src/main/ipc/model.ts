/**
 * IPC for Settings' Scout's model: read the choice and pick one. Both go through the brain's Home
 * tools (model_state, set_model); the brain owns the list and refuses an id it does not know,
 * the page is not trusted, so the id is checked to be text before the brain hears of it.
 * Contains registerModelIpc.
 */

import { parseModelState } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

const Model = z.string().min(1);

export function registerModelIpc(handle: IpcHandle, deps: { brain: BrainCall }): void {
  const { brain } = deps;
  handle(IPC.modelState, async () => parseModelState(await callJson(brain, 'model_state')));
  handle(IPC.modelSet, async (_event, model: unknown) => {
    await callJson(brain, 'set_model', { model: Model.parse(model) });
  });
}
