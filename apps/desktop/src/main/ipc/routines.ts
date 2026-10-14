import { RoutineDraft } from '@tagalong/protocol';
import type { RoutineDraftInput, RoutineProposedParams } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { EngineCall, IpcHandle } from './handle';

/** The part of Home's window the card's Edit needs. */
export interface RoutineWindow {
  webContents: {
    isLoading(): boolean;
    once(event: 'did-finish-load', listener: () => void): unknown;
    send(channel: string, ...args: unknown[]): void;
  };
}

export interface RoutineIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
  /** Opens Home (the Crew Office) on a page. */
  openOffice: (page: string) => void;
  /** Home's window, once it is open. */
  officeWindow: () => RoutineWindow | null;
}

/** Home's Routines page and the routine card. Saving, here or on the card, is consent. */
export function registerRoutineIpc(handle: IpcHandle, deps: RoutineIpcDeps): void {
  const { engine } = deps;

  handle(IPC.listRoutines, async () => {
    const { routines } = await engine().call('routines.list', {});
    return routines;
  });
  handle(IPC.saveRoutine, async (_event, routine: RoutineDraftInput & { id?: string }) => {
    const { routine: saved } = await engine().call('routines.save', {
      routine: { ...RoutineDraft.parse(routine), ...(routine.id ? { id: routine.id } : {}) },
    });
    return saved;
  });
  handle(IPC.deleteRoutine, async (_event, id: string) => {
    const { deleted } = await engine().call('routines.delete', { id });
    return deleted;
  });
  handle(IPC.setRoutineEnabled, async (_event, id: string, enabled: boolean) => {
    const { routine } = await engine().call('routines.setEnabled', { id, enabled });
    return routine;
  });
  handle(IPC.runRoutine, async (_event, id: string) => {
    const { started } = await engine().call('routines.runNow', { id });
    return started;
  });
  handle(IPC.confirmRoutine, async (_event, proposalId: string, routine?: RoutineDraftInput) =>
    engine().call('routines.confirm', {
      proposalId,
      ...(routine !== undefined ? { routine: RoutineDraft.parse(routine) } : {}),
    }),
  );
  handle(IPC.dismissRoutine, async (_event, proposalId: string) => {
    await engine().call('routines.dismiss', { proposalId });
  });
  // The card's Edit: Home opens on Routines with the card's routine in the form.
  handle(IPC.editRoutine, (_event, proposal: RoutineProposedParams) => {
    deps.openOffice('routines');
    const window = deps.officeWindow();
    if (window === null) return;
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () =>
        window.webContents.send(IPC.routineDraftEvent, proposal),
      );
    } else window.webContents.send(IPC.routineDraftEvent, proposal);
  });
}
