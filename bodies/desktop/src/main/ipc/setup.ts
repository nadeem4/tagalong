/**
 * IPC for the setup calls: what is set up (setup:overview), and setting an expert or app up
 * (setup:expert, setup:app) through the brain's Home tools. `approved` true is honoured only
 * from a window that showed the person the choice: Home for an app (the brain still asks for
 * the check card on a community one unless `communityOk`), the tour for an expert, or Home for
 * an expert with `communityOk`. Also the update calls (state, check now, update one or all,
 * the per-group auto switch). Contains registerSetupIpc.
 */

import { parseSetupOverview, parseUpdatesState } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

const SetupParams = z.object({
  id: z.string().min(1),
  approved: z.boolean(),
  query: z.string().optional(),
  communityOk: z.boolean().optional(),
});
const Result = z.object({ error: z.string().optional() }).passthrough();

export function registerSetupIpc(
  handle: IpcHandle,
  {
    brain,
    fromTour,
    fromHome,
  }: {
    brain: BrainCall;
    fromTour: (event: unknown) => boolean;
    fromHome: (event: unknown) => boolean;
  },
): void {
  // The page is not trusted: ids and flags are checked here before the brain hears of them,
  // and a skipped Allow card (approved true) is for the windows named above alone.
  const setUp =
    (tool: string, mayApprove: (event: unknown, communityOk: boolean) => boolean) =>
    async (
      event: unknown,
      id: unknown,
      approved: unknown,
      ...rest: [query?: unknown, communityOk?: unknown]
    ) => {
      // setupExpert has no query: its third argument is communityOk.
      const [query, communityOk] = tool === 'setup_app' ? rest : [undefined, rest[0]];
      const params = SetupParams.parse({ id, approved, query, communityOk });
      const ok = params.approved && mayApprove(event, params.communityOk === true);
      const input: Record<string, unknown> = { id: params.id, approved: ok };
      if (params.query !== undefined) input.query = params.query;
      if (ok && params.communityOk === true) input.community_ok = true;
      return Result.parse(await callJson(brain, tool, input));
    };

  // A query searches the app registry; a cursor pages it.
  handle(IPC.setupOverview, async (_event: unknown, query?: unknown, cursor?: unknown) => {
    const q = z.string().optional().parse(query);
    const c = z.string().optional().parse(cursor);
    const input = {
      ...(q === undefined ? {} : { query: q }),
      ...(c === undefined ? {} : { cursor: c }),
    };
    return parseSetupOverview(await callJson(brain, 'setup_overview', input));
  });
  // Updates: the brain decides when one may run (never mid-job); the page only asks.
  const Kind = z.enum(['app', 'expert']);
  handle(IPC.updatesState, async () => parseUpdatesState(await callJson(brain, 'updates_state')));
  handle(IPC.updatesCheck, async () => parseUpdatesState(await callJson(brain, 'updates_check')));
  handle(IPC.updateItem, async (_event: unknown, kind: unknown, id: unknown) =>
    Result.parse(
      await callJson(brain, 'update_item', {
        kind: Kind.parse(kind),
        id: z.string().min(1).parse(id),
      }),
    ),
  );
  handle(IPC.updateAll, async (_event: unknown, kind: unknown) =>
    Result.parse(await callJson(brain, 'update_all', { kind: Kind.parse(kind) })),
  );
  handle(
    IPC.setAutoUpdate,
    async (_event: unknown, kind: unknown, official: unknown, on: unknown) => {
      await callJson(brain, 'set_auto_update', {
        kind: Kind.parse(kind),
        official: z.boolean().parse(official),
        on: z.boolean().parse(on),
      });
    },
  );
  handle(
    IPC.setupExpert,
    setUp(
      'setup_expert',
      (event, communityOk) => fromTour(event) || (communityOk && fromHome(event)),
    ),
  );
  handle(
    IPC.setupApp,
    setUp('setup_app', (event) => fromHome(event)),
  );
}
