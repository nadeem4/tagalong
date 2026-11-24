/** Tests for the placements IPC: reading passes on this PC's node id, and setting sends the place the person chose. */
import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerPlacementsIpc } from './placements';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

function setup() {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  registerPlacementsIpc(ipc.handle, {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      return Promise.resolve(
        text({
          this_pc: 'node-ab12',
          placements: [{ kind: 'app', id: 'gmail', mode: 'brain', body_id: null, prefer: null }],
        }),
      ) as Promise<never>;
    },
  });
  return { ...ipc, calls };
}

describe('registerPlacementsIpc', () => {
  it('answers the brain placements with the this PC node the brain names', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.placementsList)).toEqual({
      thisPc: 'node-ab12',
      places: { 'app:gmail': { mode: 'brain', bodyId: null, prefer: null } },
    });
  });

  it('sets a placement through placement_set with the brain field names', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.placementsSet, 'expert', 'gemini', {
      mode: 'both',
      bodyId: 'node-ab12',
      prefer: 'ask',
    });
    expect(calls).toEqual([
      [
        'placement_set',
        { kind: 'expert', id: 'gemini', mode: 'both', body_id: 'node-ab12', prefer: 'ask' },
      ],
    ]);
  });
});
