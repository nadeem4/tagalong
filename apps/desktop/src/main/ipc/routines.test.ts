import { describe, expect, it, vi } from 'vitest';
import { RoutineDraft } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerRoutineIpc } from './routines';
import type { RoutineWindow } from './routines';

const DRAFT = {
  name: 'Morning papers',
  when: { type: 'schedule', days: [1, 2, 3, 4, 5], time: '08:00' },
  what: 'Find new papers',
};
const SAVED = { id: 'r1', name: 'Morning papers' };

function setup(window: RoutineWindow | null = null) {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'routines.list': { routines: [SAVED] },
    'routines.save': { routine: SAVED },
    'routines.delete': { deleted: true },
    'routines.setEnabled': { routine: SAVED },
    'routines.runNow': { started: true },
    'routines.confirm': { routine: SAVED },
  });
  const openOffice = vi.fn();
  registerRoutineIpc(ipc.handle, {
    engine: () => engine.client,
    openOffice,
    officeWindow: () => window,
  });
  return { ...ipc, calls: engine.calls, openOffice };
}

function fakeWindow(loading: boolean) {
  const sent: unknown[][] = [];
  let onLoad: (() => void) | undefined;
  const window: RoutineWindow = {
    webContents: {
      isLoading: () => loading,
      once: (_event, listener) => (onLoad = listener),
      send: (...args: unknown[]) => sent.push(args),
    },
  };
  return { window, sent, load: () => onLoad?.() };
}

describe('registerRoutineIpc', () => {
  it('saves a parsed draft, keeping the id of one being edited', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.saveRoutine, DRAFT)).toEqual(SAVED);
    await invoke(IPC.saveRoutine, { ...DRAFT, id: 'r1' });
    expect(calls).toEqual([
      ['routines.save', { routine: RoutineDraft.parse(DRAFT) }],
      ['routines.save', { routine: { ...RoutineDraft.parse(DRAFT), id: 'r1' } }],
    ]);
  });

  it('confirms a card as proposed, or with the edits it was given', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.confirmRoutine, 'p1')).toEqual({ routine: SAVED });
    await invoke(IPC.confirmRoutine, 'p2', DRAFT);
    await invoke(IPC.dismissRoutine, 'p3');
    expect(calls).toEqual([
      ['routines.confirm', { proposalId: 'p1' }],
      ['routines.confirm', { proposalId: 'p2', routine: RoutineDraft.parse(DRAFT) }],
      ['routines.dismiss', { proposalId: 'p3' }],
    ]);
  });

  it('lists, deletes, enables and runs routines, unwrapping each answer', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listRoutines)).toEqual([SAVED]);
    expect(await invoke(IPC.deleteRoutine, 'r1')).toBe(true);
    expect(await invoke(IPC.setRoutineEnabled, 'r1', false)).toEqual(SAVED);
    expect(await invoke(IPC.runRoutine, 'r1')).toBe(true);
    expect(calls).toEqual([
      ['routines.list', {}],
      ['routines.delete', { id: 'r1' }],
      ['routines.setEnabled', { id: 'r1', enabled: false }],
      ['routines.runNow', { id: 'r1' }],
    ]);
  });

  it("opens Home on Routines with the card's routine, once Home has loaded", async () => {
    const proposal = { proposalId: 'p1', routine: DRAFT };
    const ready = fakeWindow(false);
    const open = setup(ready.window);
    await open.invoke(IPC.editRoutine, proposal);
    expect(open.openOffice).toHaveBeenCalledWith('routines');
    expect(ready.sent).toEqual([[IPC.routineDraftEvent, proposal]]);

    const loading = fakeWindow(true);
    await setup(loading.window).invoke(IPC.editRoutine, proposal);
    expect(loading.sent).toEqual([]);
    loading.load();
    expect(loading.sent).toEqual([[IPC.routineDraftEvent, proposal]]);
  });

  it('does nothing more when Home did not open', async () => {
    const { invoke, openOffice } = setup(null);
    await invoke(IPC.editRoutine, { proposalId: 'p1', routine: DRAFT });
    expect(openOffice).toHaveBeenCalledWith('routines');
  });
});
