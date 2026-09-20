import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { ContextSnapshot, PerceptionTarget, Pet, SettingsPatch } from '@tagalong/protocol';
import type { AskInput, HostBridge, TurnEvent } from '@tagalong/ui';
import { IPC } from '../shared/ipc';
import type { CaptureNotice, HostView, TagalongHostApi } from '../shared/ipc';

/**
 * The renderer's entire view of the outside world.
 *
 * Nothing from node or electron crosses this boundary — only plain data over IPC — so a
 * compromised page can reach exactly the calls listed here and nothing else.
 */
const bridge: HostBridge = {
  ask: (input: AskInput) => ipcRenderer.invoke(IPC.ask, input) as Promise<{ turnId: string }>,
  capture: (targets: readonly PerceptionTarget[]) =>
    ipcRenderer.invoke(IPC.capture, targets) as Promise<ContextSnapshot | null>,
  interrupt: (turnId: string) => ipcRenderer.invoke(IPC.interrupt, turnId) as Promise<void>,
  listPets: () => ipcRenderer.invoke(IPC.listPets) as Promise<Pet[]>,
  onTurnEvent: (handler: (event: TurnEvent) => void) => {
    const listener = (_event: IpcRendererEvent, turnEvent: TurnEvent): void => handler(turnEvent);
    ipcRenderer.on(IPC.turnEvent, listener);
    return () => void ipcRenderer.off(IPC.turnEvent, listener);
  },
};

const host: TagalongHostApi = {
  getContext: () => ipcRenderer.invoke(IPC.getContext) as Promise<ContextSnapshot | null>,
  onContext: (handler) => {
    const listener = (_event: IpcRendererEvent, snapshot: ContextSnapshot | null): void =>
      handler(snapshot);
    ipcRenderer.on(IPC.contextEvent, listener);
    return () => void ipcRenderer.off(IPC.contextEvent, listener);
  },
  onCapture: (handler) => {
    const listener = (_event: IpcRendererEvent, notice: CaptureNotice): void => handler(notice);
    ipcRenderer.on(IPC.captureEvent, listener);
    return () => void ipcRenderer.off(IPC.captureEvent, listener);
  },
  getSightPaused: () => ipcRenderer.invoke(IPC.getSightPaused) as Promise<boolean>,
  onSightPause: (handler) => {
    const listener = (_event: IpcRendererEvent, paused: boolean): void => handler(paused);
    ipcRenderer.on(IPC.sightPauseEvent, listener);
    return () => void ipcRenderer.off(IPC.sightPauseEvent, listener);
  },
  toggleSightPause: () => ipcRenderer.invoke(IPC.toggleSightPause) as Promise<boolean>,
  onHotkeyProblem: (handler) => {
    const listener = (_event: IpcRendererEvent, problem: string | null): void => handler(problem);
    ipcRenderer.on(IPC.hotkeyProblemEvent, listener);
    return () => void ipcRenderer.off(IPC.hotkeyProblemEvent, listener);
  },
  getHostView: () => ipcRenderer.invoke(IPC.hostView) as Promise<HostView>,
  saveSettings: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  saveApiKey: (apiKey: string) => ipcRenderer.invoke(IPC.saveApiKey, apiKey) as Promise<void>,
  openSettings: () => ipcRenderer.invoke(IPC.openSettings) as Promise<void>,
  hidePanel: () => ipcRenderer.invoke(IPC.hidePanel) as Promise<void>,
  togglePanel: () => ipcRenderer.invoke(IPC.togglePanel) as Promise<void>,
};

contextBridge.exposeInMainWorld('tagalong', bridge);
contextBridge.exposeInMainWorld('tagalongHost', host);
