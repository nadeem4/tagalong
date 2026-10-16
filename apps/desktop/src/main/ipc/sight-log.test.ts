/** Tests for the What Scout saw IPC. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerSightLogIpc } from './sight-log';

const ROW = { id: 'r1', kind: 'screenshot', at: '2026-10-14T09:00:00.000Z', images: 1 };

function setup() {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'sightLog.list': { entries: [ROW] },
    'sightLog.delete': { deleted: true },
    'sightLog.clear': { deleted: 4 },
  });
  registerSightLogIpc(ipc.handle, { engine: () => engine.client });
  return { ...ipc, calls: engine.calls };
}

describe('registerSightLogIpc', () => {
  it('lists what Scout saw', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listSightLog)).toEqual([ROW]);
    expect(calls).toEqual([['sightLog.list', { limit: 200 }]]);
  });

  it('deletes one row, and all of them', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.deleteSightLog, 'r1')).toBe(true);
    expect(await invoke(IPC.clearSightLog)).toBe(4);
    expect(calls).toEqual([
      ['sightLog.delete', { id: 'r1' }],
      ['sightLog.clear', {}],
    ]);
  });

  it('handles its three channels and nothing else', () => {
    expect(setup().channels()).toEqual(
      [IPC.clearSightLog, IPC.deleteSightLog, IPC.listSightLog].sort(),
    );
  });
});
