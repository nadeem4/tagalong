/**
 * The contract between main and the preload: every IPC channel name (IPC) and the shapes
 * that cross it (HostView, CaptureNotice, SpeakResult and the rest), plus
 * TagalongHostApi, the host-only calls on `window.tagalongHost`. Types only, apart from IPC.
 */

import type { CaptureBlock } from '@tagalong/ui/shapes';
import type {
  ContextSnapshot,
  EarsEvent,
  ListenMode,
  Pet,
  PetRemarkParams,
  StatusMark,
  MouthId,
} from '@tagalong/ui/shapes';
import type { Settings, SettingsPatch, VoiceId } from './settings';
import type { DropOffer, HostBridge } from '@tagalong/ui';
import type { FixTarget } from '@tagalong/ui/shapes';

/** Channel names, in one place so main and preload cannot drift apart. */
export const IPC = {
  ask: 'tagalong:ask',
  interrupt: 'tagalong:interrupt',
  listPets: 'tagalong:pets:list',
  // Home.
  browserFolder: 'tagalong:browser:folder',
  showBrowserFolder: 'tagalong:browser:show-folder',
  approveTool: 'tagalong:tool:approve',
  answerJobAsk: 'tagalong:jobask:answer',
  listConnections: 'tagalong:connections:list',
  addConnection: 'tagalong:connections:add',
  setConnectionEnabled: 'tagalong:connections:set-enabled',
  signInConnection: 'tagalong:connections:sign-in',
  removeConnection: 'tagalong:connections:remove',
  restartConnection: 'tagalong:connections:restart',
  listMemories: 'tagalong:memory:list',
  deleteMemory: 'tagalong:memory:delete',
  listPermissions: 'tagalong:permissions:list',
  setPermission: 'tagalong:permissions:set',
  listJobs: 'tagalong:jobs:list',
  stopJob: 'tagalong:jobs:stop',
  usageSummary: 'tagalong:usage:summary',
  turnEvent: 'tagalong:turn-event',
  getContext: 'tagalong:context:get',
  contextEvent: 'tagalong:context-event',
  hostView: 'tagalong:host:view',
  saveSettings: 'tagalong:settings:save',
  openSettings: 'tagalong:settings:open',
  openLogsFolder: 'tagalong:logs:open',
  hidePanel: 'tagalong:panel:hide',
  fitPanel: 'tagalong:panel:fit',
  remarkEvent: 'tagalong:panel:remark',
  panelSideEvent: 'tagalong:panel:side',
  dragAvatar: 'tagalong:avatar:drag',
  dropAvatar: 'tagalong:avatar:drop',
  togglePanel: 'tagalong:panel:toggle',
  captureEvent: 'tagalong:capture-event',
  sightPauseEvent: 'tagalong:sight-pause-event',
  getSightPaused: 'tagalong:get-sight-paused',
  toggleSightPause: 'tagalong:toggle-sight-pause',
  hotkeyProblemEvent: 'tagalong:hotkey-problem-event',
  settingsChangedEvent: 'tagalong:settings-changed-event',
  openBubble: 'tagalong:bubble:open',
  openHome: 'tagalong:home:open',
  homePageEvent: 'tagalong:home:page',
  speak: 'tagalong:voice:speak',
  stopVoiceEvent: 'tagalong:voice:stop',
  talkEvent: 'tagalong:voice:talk',
  talkReleaseEvent: 'tagalong:voice:talk-release',
  talkCancelEvent: 'tagalong:voice:talk-cancel',
  earsListen: 'tagalong:voice:ears-listen',
  micFrame: 'tagalong:voice:mic-frame',
  earsStop: 'tagalong:voice:ears-stop',
  earsEvent: 'tagalong:voice:ears-event',
  earsStatusEvent: 'tagalong:voice:ears-status',
  ensureEars: 'tagalong:voice:ensure-ears',
  earsProgressEvent: 'tagalong:voice:ears-progress',
  getListening: 'tagalong:voice:get-listening',
  setListening: 'tagalong:voice:set-listening',
  setFollowUp: 'tagalong:voice:set-follow-up',
  listeningEvent: 'tagalong:voice:listening',
  // Drop it on Scout: a file, link or text dropped on the figure (not dropAvatar, which
  // ends a move of the pet), and the card main hands the bubble for it.
  dropOnPet: 'tagalong:avatar:drop-on-pet',
  dropEvent: 'tagalong:panel:drop',
  // The health check: whether the voice models are on disk.
  voiceModels: 'tagalong:voice:models',
  // Status marks: the top one on Scout and in the bubble, read on mount and broadcast on change.
  getStatusMark: 'tagalong:status:get',
  statusMarkEvent: 'tagalong:status:event',
  setStatusMark: 'tagalong:status:set',
  // The brain changed something Home shows (memory, permissions): pushed to every window.
  brainChangedEvent: 'tagalong:brain:changed',
  // Home's "Where things run": the address the desktop dials and whether the link is up.
  brainLink: 'tagalong:brain:link',
  // Home's Approvals page: the decision history and the preferences Scout follows.
  listApprovals: 'tagalong:approvals:list',
  listPreferences: 'tagalong:approvals:preferences:list',
  removePreference: 'tagalong:approvals:preferences:remove',
  editPreference: 'tagalong:approvals:preferences:edit',
  // Scout approved an ask under a preference: pushed to every window.
  approvedEvent: 'tagalong:approved-event',
} as const;

/** What the figure hands its preload on a drop: the files, and the drag's link and text. */
export interface PetDrop {
  files: File[];
  uri?: string;
  text?: string;
}

/** Always listening: switched on by the person, and paused while a call or full screen is in front. */
export interface ListeningState {
  on: boolean;
  paused: boolean;
  /** Scout just answered aloud: for a short while one reply needs no name. */
  followUp: boolean;
}

/** The ears' models: loading (the first time, a download), ready, or failed and why. */
export interface EarsStatus {
  status: 'loading' | 'ready' | 'failed';
  message?: string;
}

/** Settings' ▶ Preview: the voice and speed the form shows, not yet saved. */
export interface SpeakPreview {
  voice?: VoiceId;
  speed?: number;
  /** Who speaks, as the picker shows it. */
  mouth?: MouthId;
}

/**
 * What main hands back for one line: encoded audio to play, the word to use the system
 * voice instead, at `speed` (the local model is downloading, or every engine failed), or nothing at
 * all because Scout talks is switched off.
 */
export type SpeakResult =
  | { kind: 'audio'; audio: Uint8Array; mime: string }
  | { kind: 'fallback'; speed: number }
  | { kind: 'off' };

/**
 * What the host announces the moment it looks at the screen — or refuses to.
 *
 * Capture is never silent: the avatar badges every one of these, so the notice is sent on
 * every path that perceives anything, including a capture a pet's own tool asked for.
 */
export interface CaptureNotice {
  /** ISO instant of the attempt, so the badge and the tray tooltip agree on when. */
  at: string;
  /** Whether a screenshot was part of it. A selection read is not a screen capture. */
  screenshot: boolean;
  /** One sentence the panel can show as-is, written by the host. */
  message: string;
  /** Set when an exclusion rule refused the screenshot. Names the rule, nothing else. */
  blocked?: CaptureBlock;
  /**
   * Set when sight was paused, so nothing was read at all.
   *
   * Separate from `blocked` because the two are fixed differently: an exclusion by
   * editing a list, a pause by pressing a key.
   */
  paused?: boolean;
}

/** Whether the voice models are on disk, for the health check: a look, never a download. */
export interface VoiceModels {
  /** The local voice (Kokoro). */
  mouth: boolean;
  /** Every one of the ears' files. */
  ears: boolean;
}

/**
 * What a window reads about the host when it opens: settings, pets, brains and host facts.
 * Keys never come back out.
 */
export interface HostView {
  settings: Settings;
  /** Always the local Scout. */
  pets: Pet[];
  /** The desktop app's own version (not the brain's). */
  appVersion: string;
  /** Set when the global hotkey could not be registered, so settings can say why. */
  hotkeyError?: string;
  /** `process.platform`, so a hotkey reads Ctrl on Windows and Cmd on a Mac. */
  platform: string;
}

/** Where the browser add-on's folder is, and whether it has been built. */
export interface BrowserFolder {
  path: string;
  exists: boolean;
}

/**
 * What the preload can supply of the HostBridge; renderer/src/full-bridge.ts adds the rest.
 */
export type PreloadBridge = Omit<HostBridge, 'checkHealth' | 'openFix' | 'openLogs'>;

/**
 * Host-only concerns, deliberately kept off `window.tagalong`.
 *
 * `window.tagalong` is the HostBridge that @tagalong/ui knows how to consume (less three calls);
 * anything specific to this host lives here instead, so a component can never grow a
 * dependency on something the Chrome host will not have.
 */
export interface TagalongHostApi {
  getContext(): Promise<ContextSnapshot | null>;
  onContext(handler: (snapshot: ContextSnapshot | null) => void): () => void;
  /** Fires on every capture the host makes, so the avatar can badge it and the panel can
   *  show why a capture was refused. */
  onCapture(handler: (notice: CaptureNotice) => void): () => void;
  /** The current pause state, for a window that opened after the last toggle. */
  getSightPaused(): Promise<boolean>;
  /** Fires whenever the user pauses or resumes sight, so the avatar can grey its eye. */
  onSightPause(handler: (paused: boolean) => void): () => void;
  /**
   * Fires when a hotkey fails to register, and again with null once it is fixed.
   *
   * A window that only read the problem on mount would keep showing it after the user
   * corrected the binding, which is the same lie as never showing it at all.
   */
  onHotkeyProblem(handler: (problem: string | null) => void): () => void;
  /** Fires after every settings save, so an open window applies it without a restart. */
  onSettingsChanged(handler: (settings: Settings) => void): () => void;
  /**
   * Flips sight off or on, returning the state it moved to. The bubble and Settings › Privacy
   * call it; the smoke test drives the real gate through it, the one check that fails when
   * the gate is left unwired.
   */
  toggleSightPause(): Promise<boolean>;
  getHostView(): Promise<HostView>;
  saveSettings(patch: SettingsPatch): Promise<Settings>;
  /** A click on Scout: opens its bubble, or gives the open bubble the keyboard back. */
  openBubble(): Promise<void>;
  /** Opens Settings, or the section or Home page a Fix it names. Main checks the target. */
  openSettings(target?: FixTarget): Promise<void>;
  /** Opens the logs folder (the health card's Open logs folder). */
  openLogsFolder(): Promise<void>;
  /** Opens Home, or focuses it. The tray's Open Tagalong is the shipped way in. */
  openHome(): Promise<void>;
  /** Main names the Home page to show, when the tray or the bubble opens a particular one. */
  onHomePage(handler: (page: string) => void): () => void;
  /** The browser add-on's folder, for Settings' Load unpacked steps. */
  browserFolder(): Promise<BrowserFolder>;
  /** Reveals that folder in the file manager; rejects when it is not built yet. */
  showBrowserFolder(): Promise<void>;
  hidePanel(): Promise<void>;
  /** The panel measured its content; main resizes it, keeping it level with the pet. */
  fitPanel(height: number): Promise<void>;
  /** Main hands the bubble one line Scout says on its own (a wake). */
  onRemark(handler: (remark: PetRemarkParams) => void): () => void;
  /** Which side of the pet the bubble sits on, so its tail points at the pet. */
  onPanelSide(handler: (side: 'left' | 'right') => void): () => void;
  /** Moves the pet by a drag's step; the bubble follows. */
  dragAvatar(dx: number, dy: number): Promise<void>;
  /** The drag ended: remember where the pet was left. */
  dropAvatar(): Promise<void>;
  togglePanel(): Promise<void>;
  /** Turns one line into audio in main. Only this text leaves the window. */
  speak(text: string, preview?: SpeakPreview): Promise<SpeakResult>;
  /** Fires when the stop key is pressed: Scout stops speaking at once. */
  onStopVoice(handler: () => void): () => void;
  /** Fires when the talk key goes down (once per hold), with when it fired. */
  onTalk(handler: (at: number) => void): () => void;
  /** Fires when the talk key comes up: the question is asked. Seen in main, so focus never matters. */
  onTalkRelease(handler: () => void): () => void;
  /** Fires when another key went down while the talk key was held: the mic closes, nothing is sent. */
  onTalkCancel(handler: () => void): () => void;
  /** Listening starts in the voice process; a held question first notes the window you are on. */
  earsListen(mode: ListenMode): Promise<void>;
  /** One 16 kHz mono frame from the microphone, for the ears. Never kept. */
  micFrame(samples: Float32Array): void;
  /** Listening stops; a held question's words still arrive as its turnEnd. */
  earsStop(): Promise<void>;
  /** What the ears heard: speech started, the words so far, a finished turn. */
  onEarsEvent(handler: (event: EarsEvent, text?: string) => void): () => void;
  /** The ears' models loading, ready, or failed. */
  onEarsStatus(handler: (status: EarsStatus) => void): () => void;
  /** Downloads the ears' model files if missing; `onProgress` hears 0..1, ending at 1. */
  ensureEars(onProgress: (fraction: number) => void): Promise<void>;
  /** Always listening now, for a window that just opened: the mark on Scout. */
  getListening(): Promise<ListeningState>;
  /** Switches Always listening on or off, returning the state it moved to. */
  setListening(on: boolean): Promise<ListeningState>;
  /** Fires whenever Always listening is switched, paused or resumed, or its follow-up window moves. */
  onListening(handler: (state: ListeningState) => void): () => void;
  /** The follow-up window after Scout answered aloud opened or closed. */
  setFollowUp(open: boolean): Promise<void>;
  /**
   * Something was dropped on the figure. The preload turns each file into its path; main
   * names the item and opens the bubble on its card, reading nothing yet.
   */
  dropOnPet(drop: PetDrop): Promise<void>;
  /** Main hands the bubble the card for what was dropped on Scout. */
  onDrop(handler: (offer: DropOffer) => void): () => void;
  /** The health check: whether the voice models are on disk. Never downloads. */
  voiceModels(): Promise<VoiceModels>;
  /** The top status mark now, for a window that just opened. */
  getStatusMark(): Promise<StatusMark | null>;
  /** Fires with the new top status mark, or null when none is left. */
  onStatusMark(handler: (mark: StatusMark | null) => void): () => void;
  /** Sets or clears one of the panel's own marks: the mic failing, or Say “Scout”. */
  setStatusMark(id: 'mic-busy' | 'mic-failed' | 'say-name', on: boolean): Promise<void>;
}

declare global {
  interface Window {
    tagalong: PreloadBridge;
    tagalongHost: TagalongHostApi;
  }
}
