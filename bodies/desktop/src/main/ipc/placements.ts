/**
 * IPC behind the Runs on control: where each app and expert runs, read from and set through the
 * brain's placement_list and placement_set. Contains registerPlacementsIpc.
 */
import { parsePlacements } from '@tagalong/ui/shapes';
import type { Place } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import { callJson } from '../brain/call-json';
import type { BrainCall } from '../brain/call-json';
import type { IpcHandle } from './handle';

export interface PlacementsDeps {
  brain: BrainCall;
  /** The body id of the node this PC runs beside a remote brain. */
  thisPcNode: string;
}

export function registerPlacementsIpc(handle: IpcHandle, deps: PlacementsDeps): void {
  const { brain, thisPcNode } = deps;
  handle(IPC.placementsList, async () =>
    parsePlacements(await callJson(brain, 'placement_list'), thisPcNode),
  );
  handle(IPC.placementsSet, async (_event, kind: 'app' | 'expert', id: string, place: Place) => {
    await callJson(brain, 'placement_set', {
      kind,
      id,
      mode: place.mode,
      ...(place.bodyId === null ? {} : { body_id: place.bodyId }),
      ...(place.prefer === null ? {} : { prefer: place.prefer }),
    });
  });
}
