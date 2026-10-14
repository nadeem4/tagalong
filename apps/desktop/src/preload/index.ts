import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  ActivityListResult,
  ConnectionState,
  ConnectionsAddParams,
  ConnectionsListResult,
  ContextSnapshot,
  Expert,
  PerceptionTarget,
  Pet,
  PetRemarkParams,
  ProjectCandidate,
  RoutineDraftInput,
  RoutineProposedParams,
  RoutineResultParams,
  RoutineView,
  Settings,
  SettingsPatch,
} from '@tagalong/protocol';
import type { AskInput, HostBridge, TurnEvent } from '@tagalong/ui';
import { IPC } from '../shared/ipc';
import { heldUntilHeard } from './held';
import type {
  CaptureNotice,
  ClaudeSignIn,
  FoundAgent,
  HostView,
  ModelList,
  SpeakPreview,
  TranscribeResult,
  SpeakResult,
  TagalongHostApi,
} from '../shared/ipc';

/**
 * The renderer's entire view of the outside world.
 *
 * Nothing from node or electron crosses this boundary — only plain data over IPC — so a
 * compromised page can reach exactly the calls listed here and nothing else.
 */
/** A launch greeting that arrived before the panel subscribed, kept until it does. */
let earlyLine: string | null = null;
ipcRenderer.on(IPC.greetLineEvent, (_event: IpcRendererEvent, text: string) => {
  earlyLine = text;
});

/** Home's page and Scout's card, which a fresh Home window can be sent before React listens. */
const homePage = heldUntilHeard<string>();
ipcRenderer.on(IPC.homePageEvent, (_event: IpcRendererEvent, page: string) =>
  homePage.arrived(page),
);
const routineDraft = heldUntilHeard<RoutineProposedParams>();
ipcRenderer.on(IPC.routineDraftEvent, (_event: IpcRendererEvent, proposal: RoutineProposedParams) =>
  routineDraft.arrived(proposal),
);

const bridge: HostBridge = {
  ask: (input: AskInput) => ipcRenderer.invoke(IPC.ask, input) as Promise<{ turnId: string }>,
  capture: (targets: readonly PerceptionTarget[]) =>
    ipcRenderer.invoke(IPC.capture, targets) as Promise<ContextSnapshot | null>,
  interrupt: (turnId: string) => ipcRenderer.invoke(IPC.interrupt, turnId) as Promise<void>,
  listPets: () => ipcRenderer.invoke(IPC.listPets) as Promise<Pet[]>,
  stopWatch: (watchId: string) => ipcRenderer.invoke(IPC.stopWatch, watchId) as Promise<void>,
  // Home.
  listActivity: (params: { before?: string; limit?: number } = {}) =>
    ipcRenderer.invoke(IPC.listActivity, params) as Promise<ActivityListResult>,
  listExperts: () => ipcRenderer.invoke(IPC.listExperts) as Promise<Expert[]>,
  saveExpert: (expert: Expert) => ipcRenderer.invoke(IPC.saveExpert, expert) as Promise<Expert>,
  deleteExpert: (expertId: string) =>
    ipcRenderer.invoke(IPC.deleteExpert, expertId) as Promise<boolean>,
  testExpert: (expertId: string) =>
    ipcRenderer.invoke(IPC.testExpert, expertId) as Promise<{ ok: boolean; error?: string }>,
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder) as Promise<string | null>,
  confirmHandoff: (params) =>
    ipcRenderer.invoke(IPC.confirmHandoff, params) as Promise<{ handoffId: string }>,
  dismissHandoff: (proposalId: string) =>
    ipcRenderer.invoke(IPC.dismissHandoff, proposalId) as Promise<void>,
  cancelHandoff: (handoffId: string) =>
    ipcRenderer.invoke(IPC.cancelHandoff, handoffId) as Promise<void>,
  searchProjects: (query: string) =>
    ipcRenderer.invoke(IPC.searchProjects, query) as Promise<ProjectCandidate[]>,
  approveTool: (approvalId: string, decision: 'once' | 'deny') =>
    ipcRenderer.invoke(IPC.approveTool, approvalId, decision) as Promise<void>,
  listConnections: () => ipcRenderer.invoke(IPC.listConnections) as Promise<ConnectionsListResult>,
  addConnection: (params: ConnectionsAddParams) =>
    ipcRenderer.invoke(IPC.addConnection, params) as Promise<ConnectionState>,
  setConnectionEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.setConnectionEnabled, id, enabled) as Promise<ConnectionState>,
  signInConnection: (id: string) =>
    ipcRenderer.invoke(IPC.signInConnection, id) as Promise<ConnectionState>,
  removeConnection: (id: string) =>
    ipcRenderer.invoke(IPC.removeConnection, id) as Promise<boolean>,
  listRoutines: () => ipcRenderer.invoke(IPC.listRoutines) as Promise<RoutineView[]>,
  saveRoutine: (routine: RoutineDraftInput & { id?: string }) =>
    ipcRenderer.invoke(IPC.saveRoutine, routine) as Promise<RoutineView>,
  deleteRoutine: (id: string) => ipcRenderer.invoke(IPC.deleteRoutine, id) as Promise<boolean>,
  setRoutineEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.setRoutineEnabled, id, enabled) as Promise<RoutineView>,
  runRoutine: (id: string) => ipcRenderer.invoke(IPC.runRoutine, id) as Promise<boolean>,
  confirmRoutine: (proposalId: string, routine?: RoutineDraftInput) =>
    ipcRenderer.invoke(IPC.confirmRoutine, proposalId, routine) as Promise<{
      routine?: RoutineView;
      deleted?: boolean;
    }>,
  dismissRoutine: (proposalId: string) =>
    ipcRenderer.invoke(IPC.dismissRoutine, proposalId) as Promise<void>,
  editRoutine: (proposal: RoutineProposedParams) =>
    ipcRenderer.invoke(IPC.editRoutine, proposal) as Promise<void>,
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
  onSettingsChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, settings: Settings): void => handler(settings);
    ipcRenderer.on(IPC.settingsChangedEvent, listener);
    return () => void ipcRenderer.off(IPC.settingsChangedEvent, listener);
  },
  getRecording: () => ipcRenderer.invoke(IPC.getRecording) as Promise<boolean>,
  onRecording: (handler) => {
    const listener = (_event: IpcRendererEvent, recording: boolean): void => handler(recording);
    ipcRenderer.on(IPC.recordingEvent, listener);
    return () => void ipcRenderer.off(IPC.recordingEvent, listener);
  },
  getHostView: () => ipcRenderer.invoke(IPC.hostView) as Promise<HostView>,
  saveSettings: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  saveApiKey: (providerId: string, apiKey: string) =>
    ipcRenderer.invoke(IPC.saveApiKey, providerId, apiKey) as Promise<void>,
  savePet: (pet: Pet) => ipcRenderer.invoke(IPC.savePet, pet) as Promise<Pet>,
  selectPet: (petId: string) => ipcRenderer.invoke(IPC.selectPet, petId) as Promise<void>,
  onActivePet: (handler) => {
    const listener = (_event: IpcRendererEvent, petId: string): void => handler(petId);
    ipcRenderer.on(IPC.activePetEvent, listener);
    return () => void ipcRenderer.off(IPC.activePetEvent, listener);
  },
  fitPanel: (height: number) => ipcRenderer.invoke(IPC.fitPanel, height) as Promise<void>,
  onPanelSide: (handler) => {
    const listener = (_event: IpcRendererEvent, side: 'left' | 'right'): void => handler(side);
    ipcRenderer.on(IPC.panelSideEvent, listener);
    return () => void ipcRenderer.off(IPC.panelSideEvent, listener);
  },
  dragAvatar: (dx: number, dy: number) =>
    ipcRenderer.invoke(IPC.dragAvatar, dx, dy) as Promise<void>,
  dropAvatar: () => ipcRenderer.invoke(IPC.dropAvatar) as Promise<void>,
  onGreet: (handler) => {
    const listener = (): void => handler();
    ipcRenderer.on(IPC.greetEvent, listener);
    return () => void ipcRenderer.off(IPC.greetEvent, listener);
  },
  onGreetLine: (handler) => {
    // The line can arrive before React has subscribed; one that did is handed over now.
    if (earlyLine !== null) handler(earlyLine);
    earlyLine = null;
    const listener = (_event: IpcRendererEvent, text: string): void => {
      earlyLine = null;
      handler(text);
    };
    ipcRenderer.on(IPC.greetLineEvent, listener);
    return () => void ipcRenderer.off(IPC.greetLineEvent, listener);
  },
  onRemark: (handler) => {
    const listener = (_event: IpcRendererEvent, remark: PetRemarkParams): void => handler(remark);
    ipcRenderer.on(IPC.remarkEvent, listener);
    return () => void ipcRenderer.off(IPC.remarkEvent, listener);
  },
  onRoutine: (handler) => {
    const listener = (
      _event: IpcRendererEvent,
      result: RoutineResultParams,
      how: { line: boolean; speak: boolean },
    ): void => handler(result, how);
    ipcRenderer.on(IPC.routineEvent, listener);
    return () => void ipcRenderer.off(IPC.routineEvent, listener);
  },
  onRoutineDraft: (handler) => routineDraft.listen(handler),
  remarkNotNow: () => ipcRenderer.invoke(IPC.remarkNotNow) as Promise<void>,
  remarkAccept: (remarkId: string) =>
    ipcRenderer.invoke(IPC.remarkAccept, remarkId) as Promise<void>,
  resizeStrip: (visiblePets: number) =>
    ipcRenderer.invoke(IPC.resizeStrip, visiblePets) as Promise<void>,
  listModels: (providerId: string) =>
    ipcRenderer.invoke(IPC.listModels, providerId) as Promise<ModelList>,
  openSettings: () => ipcRenderer.invoke(IPC.openSettings) as Promise<void>,
  openOnboarding: () => ipcRenderer.invoke(IPC.openOnboarding) as Promise<void>,
  openOffice: () => ipcRenderer.invoke(IPC.openOffice) as Promise<void>,
  onHomePage: (handler) => homePage.listen(handler),
  findAgents: () => ipcRenderer.invoke(IPC.findAgents) as Promise<FoundAgent[]>,
  finishWelcome: (providerId: string) =>
    ipcRenderer.invoke(IPC.finishWelcome, providerId) as Promise<void>,
  checkClaudeSignIn: () => ipcRenderer.invoke(IPC.checkClaudeSignIn) as Promise<ClaudeSignIn>,
  switchScout: (providerId: string) =>
    ipcRenderer.invoke(IPC.switchScout, providerId) as Promise<Pet>,
  openLink: (url: string) => ipcRenderer.invoke(IPC.openLink, url) as Promise<void>,
  showExtensionFolder: () => ipcRenderer.invoke(IPC.showExtensionFolder) as Promise<void>,
  hidePanel: () => ipcRenderer.invoke(IPC.hidePanel) as Promise<void>,
  togglePanel: () => ipcRenderer.invoke(IPC.togglePanel) as Promise<void>,
  speak: (text: string, preview?: SpeakPreview) =>
    ipcRenderer.invoke(IPC.speak, text, preview) as Promise<SpeakResult>,
  onStopVoice: (handler) => {
    const listener = (): void => handler();
    ipcRenderer.on(IPC.stopVoiceEvent, listener);
    return () => void ipcRenderer.off(IPC.stopVoiceEvent, listener);
  },
  onTalk: (handler) => {
    const listener = (_event: IpcRendererEvent, at: number): void => handler(at);
    ipcRenderer.on(IPC.talkEvent, listener);
    return () => void ipcRenderer.off(IPC.talkEvent, listener);
  },
  prepareListening: () => ipcRenderer.invoke(IPC.prepareListening) as Promise<{ ready: boolean }>,
  transcribe: (samples: Float32Array) =>
    ipcRenderer.invoke(IPC.transcribe, samples) as Promise<TranscribeResult>,
};

contextBridge.exposeInMainWorld('tagalong', bridge);
contextBridge.exposeInMainWorld('tagalongHost', host);
