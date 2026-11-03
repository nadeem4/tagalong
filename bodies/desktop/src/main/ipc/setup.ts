/**
 * IPC for the setup calls: what is set up (setup:overview), and setting an expert or app up
 * (setup:expert, setup:app) through the brain's Home tools. `approved` is false from the
 * Connections page (the brain opens the Allow card); only the tour window's button press may
 * send true, and only for an expert. Contains registerSetupIpc.
 */

import { parseSetupOverview } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

const SetupParams = z.object({
  id: z.string().min(1),
  approved: z.boolean(),
  query: z.string().optional(),
});
const Result = z.object({ error: z.string().optional() }).passthrough();

export function registerSetupIpc(
  handle: IpcHandle,
  { brain, fromTour }: { brain: BrainCall; fromTour: (event: unknown) => boolean },
): void {
  // The page is not trusted: ids and flags are checked here before the brain hears of them,
  // and a skipped Allow card (approved true) is the tour window's alone to ask for.
  const setUp =
    (tool: string, tourMayApprove: boolean) =>
    async (event: unknown, id: unknown, approved: unknown, query?: unknown) => {
      const params = SetupParams.parse({ id, approved, query });
      const skip = tourMayApprove && params.approved && fromTour(event);
      return Result.parse(await callJson(brain, tool, { ...params, approved: skip }));
    };

  // A query searches the app registry, so the tour can find one app instead of the first page.
  handle(IPC.setupOverview, async (_event: unknown, query?: unknown) => {
    const q = z.string().optional().parse(query);
    return parseSetupOverview(
      await callJson(brain, 'setup_overview', q === undefined ? undefined : { query: q }),
    );
  });
  handle(IPC.setupExpert, setUp('setup_expert', true));
  handle(IPC.setupApp, setUp('setup_app', false));
}
