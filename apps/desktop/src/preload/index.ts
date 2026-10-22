/**
 * The renderer's entire view of the outside world: `window.tagalong` (the HostBridge that
 * @tagalong/ui consumes) and `window.tagalongHost` (this host's own calls). Nothing from node
 * or electron crosses this boundary, only plain data over IPC, so a compromised page can reach
 * exactly the calls listed here and nothing else.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type {
  ActivityListResult,
  ExperienceGetResult,
  ExperienceListResult,
  CalendarCheckResult,
  CatalogStatus,
  ConnectionState,
  ConnectionsAddParams,
  ConnectionsListResult,
  ContextSnapshot,
  EarsEvent,
  Expert,
  PerceptionTarget,
  Pet,
  PetRemarkParams,
  ProjectCandidate,
  ProvidersCheckResult,
  RoutineDraftInput,
  RoutineProposedParams,
  RoutineResultParams,
  RoutineView,
  UsageSummaryResult,
  Settings,
  SettingsPatch,
  SightLogEntry,
  StatusMark,
  MemoryEntry,
} from '@tagalong/protocol';
import type { AskInput, DropOffer, HostBridge, TurnEvent } from '@tagalong/ui';
import { IPC } from '../shared/ipc';
import { heldUntilHeard } from './held';
import type {
  CaptureNotice,
  ClaudeSignIn,
  EarsStatus,
  GreetLine,
  HostView,
  ListeningState,
  ModelList,
  PointerRing,
  SpeakPreview,
  SpeakResult,
  TagalongHostApi,
  VoiceModels,
} from '../shared/ipc';

/** A launch greeting that arrived before the panel subscribed, kept until it does. */
const greetLine = heldUntilHeard<GreetLine>();
ipcRenderer.on(IPC.greetLineEvent, (_event: IpcRendererEvent, line: GreetLine) =>
  greetLine.arrived(line),
);

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
  listExperience: (params: { before?: string; limit?: number } = {}) =>
    ipcRenderer.invoke(IPC.listExperience, params) as Promise<ExperienceListResult>,
  getExperience: (id: string) =>
    ipcRenderer.invoke(IPC.getExperience, id) as Promise<ExperienceGetResult>,
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
  openPickUp: (itemId: string) => ipcRenderer.invoke(IPC.openPickUp, itemId) as Promise<void>,
  rebriefPickUp: (itemId: string) => ipcRenderer.invoke(IPC.rebriefPickUp, itemId) as Promise<void>,
  dismissPickUp: () => ipcRenderer.invoke(IPC.dismissPickUp) as Promise<void>,
  listSightLog: () => ipcRenderer.invoke(IPC.listSightLog) as Promise<SightLogEntry[]>,
  deleteSightLog: (id: string) => ipcRenderer.invoke(IPC.deleteSightLog, id) as Promise<boolean>,
  clearSightLog: () => ipcRenderer.invoke(IPC.clearSightLog) as Promise<number>,
  listMemories: () => ipcRenderer.invoke(IPC.listMemories) as Promise<MemoryEntry[]>,
  deleteMemory: (id: string) => ipcRenderer.invoke(IPC.deleteMemory, id) as Promise<boolean>,
  copyText: (text: string) => ipcRenderer.invoke(IPC.copyText, text) as Promise<void>,
  setCalendarLink: (link: string | null) =>
    ipcRenderer.invoke(IPC.setCalendarLink, link) as Promise<CalendarCheckResult>,
  checkCalendar: () => ipcRenderer.invoke(IPC.checkCalendar) as Promise<CalendarCheckResult>,
  usageSummary: () => ipcRenderer.invoke(IPC.usageSummary) as Promise<UsageSummaryResult>,
  applySettings: (patch: SettingsPatch) =>
    ipcRenderer.invoke(IPC.applySettings, patch) as Promise<void>,
  expertCatalog: () => ipcRenderer.invoke(IPC.expertCatalog) as Promise<CatalogStatus[]>,
  installExpert: (catalogId: string) =>
    ipcRenderer.invoke(IPC.installExpert, catalogId) as Promise<{
      ok: boolean;
      installed: string[];
      error?: string;
    }>,
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
  checkKey: (providerId: string) =>
    ipcRenderer.invoke(IPC.checkKey, providerId) as Promise<ProvidersCheckResult>,
  openClaudeSignIn: () => ipcRenderer.invoke(IPC.openClaudeSignIn) as Promise<void>,
  savePet: (pet: Pet) => ipcRenderer.invoke(IPC.savePet, pet) as Promise<Pet>,
  openBubble: () => ipcRenderer.invoke(IPC.openBubble) as Promise<void>,
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
  // The line can arrive before React has subscribed; one that did is handed over then.
  onGreetLine: (handler) => greetLine.listen(handler),
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
  listModels: (providerId: string) =>
    ipcRenderer.invoke(IPC.listModels, providerId) as Promise<ModelList>,
  openSettings: (target) => ipcRenderer.invoke(IPC.openSettings, target) as Promise<void>,
  openLogsFolder: () => ipcRenderer.invoke(IPC.openLogsFolder) as Promise<void>,
  openWelcome: () => ipcRenderer.invoke(IPC.openWelcome) as Promise<void>,
  openHome: () => ipcRenderer.invoke(IPC.openHome) as Promise<void>,
  onHomePage: (handler) => homePage.listen(handler),
  finishWelcome: (providerId: string) =>
    ipcRenderer.invoke(IPC.finishWelcome, providerId) as Promise<void>,
  checkClaudeSignIn: () => ipcRenderer.invoke(IPC.checkClaudeSignIn) as Promise<ClaudeSignIn>,
  switchScout: (providerId: string) =>
    ipcRenderer.invoke(IPC.switchScout, providerId) as Promise<Pet>,
  openLink: (url: string) => ipcRenderer.invoke(IPC.openLink, url) as Promise<void>,
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
  earsListen: (mode) => ipcRenderer.invoke(IPC.earsListen, mode) as Promise<void>,
  // A frame at a time, without waiting for an answer: the ears are in the voice process.
  micFrame: (samples) => ipcRenderer.send(IPC.micFrame, samples),
  earsStop: () => ipcRenderer.invoke(IPC.earsStop) as Promise<void>,
  onEarsEvent: (handler) => {
    const listener = (
      _event: IpcRendererEvent,
      payload: { event: EarsEvent; text?: string },
    ): void => handler(payload.event, payload.text);
    ipcRenderer.on(IPC.earsEvent, listener);
    return () => void ipcRenderer.off(IPC.earsEvent, listener);
  },
  onEarsStatus: (handler) => {
    const listener = (_event: IpcRendererEvent, status: EarsStatus): void => handler(status);
    ipcRenderer.on(IPC.earsStatusEvent, listener);
    return () => void ipcRenderer.off(IPC.earsStatusEvent, listener);
  },
  ensureEars: async (onProgress) => {
    const listener = (_event: IpcRendererEvent, payload: { fraction: number }): void =>
      onProgress(payload.fraction);
    ipcRenderer.on(IPC.earsProgressEvent, listener);
    try {
      await ipcRenderer.invoke(IPC.ensureEars);
    } finally {
      ipcRenderer.off(IPC.earsProgressEvent, listener);
    }
  },
  getListening: () => ipcRenderer.invoke(IPC.getListening) as Promise<ListeningState>,
  setListening: (on) => ipcRenderer.invoke(IPC.setListening, on) as Promise<ListeningState>,
  setFollowUp: (open) => ipcRenderer.invoke(IPC.setFollowUp, open) as Promise<void>,
  onListening: (handler) => {
    const listener = (_event: IpcRendererEvent, state: ListeningState): void => handler(state);
    ipcRenderer.on(IPC.listeningEvent, listener);
    return () => void ipcRenderer.off(IPC.listeningEvent, listener);
  },
  onPointer: (handler) => {
    const listener = (_event: IpcRendererEvent, ring: PointerRing): void => handler(ring);
    ipcRenderer.on(IPC.pointerShow, listener);
    return () => void ipcRenderer.off(IPC.pointerShow, listener);
  },
  // File.path is gone in Electron 44: webUtils, which a sandboxed preload may use, gives
  // the path. A File made in script, with no file behind it, gives '' and is left out.
  dropOnPet: ({ files, uri, text }) =>
    ipcRenderer.invoke(IPC.dropOnPet, {
      paths: files.map((file) => webUtils.getPathForFile(file)).filter((path) => path !== ''),
      ...(uri !== undefined ? { uri } : {}),
      ...(text !== undefined ? { text } : {}),
    }) as Promise<void>,
  onDrop: (handler) => {
    const listener = (_event: IpcRendererEvent, offer: DropOffer): void => handler(offer);
    ipcRenderer.on(IPC.dropEvent, listener);
    return () => void ipcRenderer.off(IPC.dropEvent, listener);
  },
  voiceModels: () => ipcRenderer.invoke(IPC.voiceModels) as Promise<VoiceModels>,
  hostsStatus: () => ipcRenderer.invoke(IPC.hostsStatus) as Promise<{ extension: boolean }>,
  getStatusMark: () => ipcRenderer.invoke(IPC.getStatusMark) as Promise<StatusMark | null>,
  setStatusMark: (id, on) => ipcRenderer.invoke(IPC.setStatusMark, id, on) as Promise<void>,
  onStatusMark: (handler) => {
    const listener = (_event: IpcRendererEvent, mark: StatusMark | null): void => handler(mark);
    ipcRenderer.on(IPC.statusMarkEvent, listener);
    return () => void ipcRenderer.off(IPC.statusMarkEvent, listener);
  },
};

contextBridge.exposeInMainWorld('tagalong', bridge);
contextBridge.exposeInMainWorld('tagalongHost', host);
