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
  AppAddParams,
  AppsList,
  AsksListResult,
  ExperienceGetResult,
  ExperienceListResult,
  SelfGetResult,
  SelfListResult,
  CalendarCheckResult,
  CatalogStatus,
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
  Settings,
  SettingsPatch,
  SightLogEntry,
  StatusMark,
  MemoryEntry,
} from '@tagalong/protocol';
import type {
  AskInput,
  BrainLink,
  DropOffer,
  HostBridge,
  ApprovalCounts,
  ApprovalRow,
  JobRow,
  PreferenceRow,
  PermissionRow,
  SpendToday,
  TurnEvent,
} from '@tagalong/ui';
import { IPC } from '../shared/ipc';
import { heldUntilHeard } from './held';
import type {
  BrowserFolder,
  CaptureNotice,
  ClaudeSignIn,
  EarsStatus,
  GreetLine,
  HostView,
  ListeningState,
  ModelList,
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
  clearExperience: () => ipcRenderer.invoke(IPC.clearExperience) as Promise<number>,
  listSelf: () => ipcRenderer.invoke(IPC.listSelf) as Promise<SelfListResult>,
  getSelf: (path: string) => ipcRenderer.invoke(IPC.getSelf, path) as Promise<SelfGetResult>,
  writeSelf: (path: string, text: string) =>
    ipcRenderer.invoke(IPC.writeSelf, path, text) as Promise<{
      ok: boolean;
      reason?: string;
      note?: string;
    }>,
  undoSelf: (versionId: number) =>
    ipcRenderer.invoke(IPC.undoSelf, versionId) as Promise<{ ok: boolean; reason?: string }>,
  acceptSelf: (versionId: number) =>
    ipcRenderer.invoke(IPC.acceptSelf, versionId) as Promise<{ ok: boolean; reason?: string }>,
  rejectSelf: (versionId: number) =>
    ipcRenderer.invoke(IPC.rejectSelf, versionId) as Promise<{ ok: boolean; reason?: string }>,
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
  approveTool: (approvalId: string, decision: 'once' | 'always' | 'deny') =>
    ipcRenderer.invoke(IPC.approveTool, approvalId, decision) as Promise<void>,
  answerJobAsk: (approvalId: string, answer: { option: string; text?: string }) =>
    ipcRenderer.invoke(IPC.answerJobAsk, approvalId, answer) as Promise<void>,
  listAsks: () => ipcRenderer.invoke(IPC.listAsks) as Promise<AsksListResult>,
  answerAsk: (id: string, decision: 'approve' | 'decline') =>
    ipcRenderer.invoke(IPC.answerAsk, id, decision) as Promise<boolean>,
  openAsk: (id: string) => ipcRenderer.invoke(IPC.openAsk, id) as Promise<boolean>,
  listConnections: () => ipcRenderer.invoke(IPC.listConnections) as Promise<AppsList>,
  addConnection: (params: AppAddParams) =>
    ipcRenderer.invoke(IPC.addConnection, params) as Promise<{ id: string }>,
  setConnectionEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.setConnectionEnabled, id, enabled) as Promise<unknown>,
  restartConnection: (id: string) =>
    ipcRenderer.invoke(IPC.restartConnection, id) as Promise<unknown>,
  signInConnection: (id: string) =>
    ipcRenderer.invoke(IPC.signInConnection, id) as Promise<unknown>,
  removeConnection: (id: string) =>
    ipcRenderer.invoke(IPC.removeConnection, id) as Promise<unknown>,
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
  listPermissions: () => ipcRenderer.invoke(IPC.listPermissions) as Promise<PermissionRow[]>,
  setPermission: (tool: string, mode: 'ask' | 'auto') =>
    ipcRenderer.invoke(IPC.setPermission, tool, mode) as Promise<void>,
  brainLink: () => ipcRenderer.invoke(IPC.brainLink) as Promise<BrainLink>,
  listJobs: () => ipcRenderer.invoke(IPC.listJobs) as Promise<JobRow[]>,
  stopJob: (job: string) => ipcRenderer.invoke(IPC.stopJob, job) as Promise<void>,
  listApprovals: (filter: 'all' | 'scout' | 'refused', before?: number) =>
    ipcRenderer.invoke(IPC.listApprovals, filter, before) as Promise<{
      approvals: ApprovalRow[];
      counts: ApprovalCounts;
      next: number | null;
    }>,
  listPreferences: () => ipcRenderer.invoke(IPC.listPreferences) as Promise<PreferenceRow[]>,
  removePreference: (id: number) => ipcRenderer.invoke(IPC.removePreference, id) as Promise<void>,
  editPreference: (id: number, sentence: string) =>
    ipcRenderer.invoke(IPC.editPreference, id, sentence) as Promise<void>,
  onApproved: (
    handler: (n: { tool: string; text: string; preference: string; cameUp?: boolean }) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      n: { tool: string; text: string; preference: string; cameUp?: boolean },
    ): void => handler(n);
    ipcRenderer.on(IPC.approvedEvent, listener);
    return () => void ipcRenderer.off(IPC.approvedEvent, listener);
  },
  copyText: (text: string) => ipcRenderer.invoke(IPC.copyText, text) as Promise<void>,
  setCalendarLink: (link: string | null) =>
    ipcRenderer.invoke(IPC.setCalendarLink, link) as Promise<CalendarCheckResult>,
  checkCalendar: () => ipcRenderer.invoke(IPC.checkCalendar) as Promise<CalendarCheckResult>,
  usageSummary: () => ipcRenderer.invoke(IPC.usageSummary) as Promise<SpendToday>,
  onBrainChanged: (handler: (what: string) => void) => {
    const listener = (_event: IpcRendererEvent, what: string): void => handler(what);
    ipcRenderer.on(IPC.brainChangedEvent, listener);
    return () => void ipcRenderer.off(IPC.brainChangedEvent, listener);
  },
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
  openHome: () => ipcRenderer.invoke(IPC.openHome) as Promise<void>,
  onHomePage: (handler) => homePage.listen(handler),
  checkClaudeSignIn: () => ipcRenderer.invoke(IPC.checkClaudeSignIn) as Promise<ClaudeSignIn>,
  switchScout: (providerId: string) =>
    ipcRenderer.invoke(IPC.switchScout, providerId) as Promise<Pet>,
  browserFolder: () => ipcRenderer.invoke(IPC.browserFolder) as Promise<BrowserFolder>,
  showBrowserFolder: () => ipcRenderer.invoke(IPC.showBrowserFolder) as Promise<void>,
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
  onTalkRelease: (handler) => {
    const listener = (): void => handler();
    ipcRenderer.on(IPC.talkReleaseEvent, listener);
    return () => void ipcRenderer.off(IPC.talkReleaseEvent, listener);
  },
  onTalkCancel: (handler) => {
    const listener = (): void => handler();
    ipcRenderer.on(IPC.talkCancelEvent, listener);
    return () => void ipcRenderer.off(IPC.talkCancelEvent, listener);
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
