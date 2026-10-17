/**
 * The contract between main and the preload: every IPC channel name (IPC) and the shapes
 * that cross it (HostView, GreetLine, CaptureNotice, SpeakResult and the rest), plus
 * TagalongHostApi, the host-only calls on `window.tagalongHost`. Types only, apart from IPC.
 */

import type { CaptureBlock } from '@tagalong/core';
import type {
  ContextSnapshot,
  EarsEvent,
  ListenMode,
  Pet,
  PetRemarkParams,
  PickUpReadyParams,
  ProvidersCheckResult,
  RoutineProposedParams,
  RoutineResultParams,
  Settings,
  SettingsPatch,
  StatusId,
  StatusMark,
  MouthId,
  VoiceId,
} from '@tagalong/protocol';
import type { DropOffer, FixTarget, HostBridge } from '@tagalong/ui';

/** Channel names, in one place so main and preload cannot drift apart. */
export const IPC = {
  ask: 'tagalong:ask',
  interrupt: 'tagalong:interrupt',
  listPets: 'tagalong:pets:list',
  // Home.
  listActivity: 'tagalong:activity:list',
  listExperts: 'tagalong:experts:list',
  saveExpert: 'tagalong:experts:save',
  deleteExpert: 'tagalong:experts:delete',
  testExpert: 'tagalong:experts:test',
  pickFolder: 'tagalong:dialog:pick-folder',
  confirmHandoff: 'tagalong:handoffs:confirm',
  dismissHandoff: 'tagalong:handoffs:dismiss',
  cancelHandoff: 'tagalong:handoffs:cancel',
  searchProjects: 'tagalong:projects:search',
  approveTool: 'tagalong:tool:approve',
  listConnections: 'tagalong:connections:list',
  addConnection: 'tagalong:connections:add',
  setConnectionEnabled: 'tagalong:connections:set-enabled',
  signInConnection: 'tagalong:connections:sign-in',
  removeConnection: 'tagalong:connections:remove',
  listRoutines: 'tagalong:routines:list',
  saveRoutine: 'tagalong:routines:save',
  deleteRoutine: 'tagalong:routines:delete',
  setRoutineEnabled: 'tagalong:routines:set-enabled',
  runRoutine: 'tagalong:routines:run',
  confirmRoutine: 'tagalong:routines:confirm',
  dismissRoutine: 'tagalong:routines:dismiss',
  editRoutine: 'tagalong:routines:edit',
  listSightLog: 'tagalong:sight-log:list',
  deleteSightLog: 'tagalong:sight-log:delete',
  clearSightLog: 'tagalong:sight-log:clear',
  listMemories: 'tagalong:memory:list',
  deleteMemory: 'tagalong:memory:delete',
  setCalendarLink: 'tagalong:calendar:set-link',
  checkCalendar: 'tagalong:calendar:check',
  usageSummary: 'tagalong:usage:summary',
  routineEvent: 'tagalong:panel:routine',
  routineDraftEvent: 'tagalong:home:routine-draft',
  turnEvent: 'tagalong:turn-event',
  getContext: 'tagalong:context:get',
  capture: 'tagalong:capture',
  contextEvent: 'tagalong:context-event',
  hostView: 'tagalong:host:view',
  saveSettings: 'tagalong:settings:save',
  saveApiKey: 'tagalong:secret:api-key',
  checkKey: 'tagalong:secret:check-key',
  savePet: 'tagalong:pets:save',
  listModels: 'tagalong:models:list',
  openSettings: 'tagalong:settings:open',
  hidePanel: 'tagalong:panel:hide',
  fitPanel: 'tagalong:panel:fit',
  greetEvent: 'tagalong:panel:greet',
  greetLineEvent: 'tagalong:panel:greet-line',
  remarkEvent: 'tagalong:panel:remark',
  remarkNotNow: 'tagalong:remark:not-now',
  remarkAccept: 'tagalong:remark:accept',
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
  recordingEvent: 'tagalong:recording-event',
  getRecording: 'tagalong:get-recording',
  stopWatch: 'tagalong:watch:stop',
  openWelcome: 'tagalong:welcome:open',
  openHome: 'tagalong:home:open',
  homePageEvent: 'tagalong:home:page',
  finishWelcome: 'tagalong:welcome:finish',
  openLink: 'tagalong:link:open',
  checkClaudeSignIn: 'tagalong:claude:sign-in',
  openClaudeSignIn: 'tagalong:claude:open-sign-in',
  switchScout: 'tagalong:pets:switch-scout',
  speak: 'tagalong:voice:speak',
  stopVoiceEvent: 'tagalong:voice:stop',
  talkEvent: 'tagalong:voice:talk',
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
  // Point, don't click: the ring to draw on one display's overlay. Main to renderer only.
  pointerShow: 'tagalong:pointer:show',
  // Pick up where you left off: the card's buttons. Open names an item id, never a path.
  openPickUp: 'tagalong:pick-up:open',
  rebriefPickUp: 'tagalong:pick-up:rebrief',
  dismissPickUp: 'tagalong:pick-up:dismiss',
  // Draft it for me: a draft's Copy, from the bubble only. Writes the clipboard, never reads it.
  copyText: 'tagalong:clipboard:copy-text',
  // Drop it on Scout: a file, link or text dropped on the figure (not dropAvatar, which
  // ends a move of the pet), and the card main hands the bubble for it.
  dropOnPet: 'tagalong:avatar:drop-on-pet',
  dropEvent: 'tagalong:panel:drop',
  // The health check: whether the voice models are on disk, and whether the extension is in.
  voiceModels: 'tagalong:voice:models',
  hostsStatus: 'tagalong:hosts:status',
  // Change settings by talking: Apply on Scout's settings card, a click only.
  applySettings: 'tagalong:settings:apply',
  expertCatalog: 'tagalong:experts:catalog',
  installExpert: 'tagalong:experts:install',
  // Status marks: the top one on Scout and in the bubble, read on mount and broadcast on change.
  getStatusMark: 'tagalong:status:get',
  statusMarkEvent: 'tagalong:status:event',
  setStatusMark: 'tagalong:status:set',
} as const;

/** What the figure hands its preload on a drop: the files, and the drag's link and text. */
export interface PetDrop {
  files: File[];
  uri?: string;
  text?: string;
}

/** One ring: where on its display, in DIP relative to the display's corner, and its label. */
export interface PointerRing {
  rect: { x: number; y: number; width: number; height: number };
  label: string;
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
 * voice instead (the local model is downloading, or every engine failed), or nothing at
 * all because Scout talks is switched off.
 */
export type SpeakResult =
  { kind: 'audio'; audio: Uint8Array; mime: string } | { kind: 'fallback' } | { kind: 'off' };

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

/** One brain Scout can run on, as Settings and Welcome list it. */
export interface ProviderChoice {
  id: string;
  label: string;
  /** Present for OpenAI-compatible presets: the URL used when settings name none. */
  defaultBaseUrl?: string;
  needsKey: boolean;
  /** Whether a key is stored. The key itself never comes back out. */
  hasKey: boolean;
}

/**
 * Whether Claude Code is signed in on this computer, from `claude auth status`.
 * `unknown` when claude ran but the answer could not be read (a timeout, odd output).
 */
export type ClaudeSignIn = 'signed-in' | 'signed-out' | 'not-installed' | 'unknown';

/**
 * The line main hands the bubble as the app opens: the brain's words (with a pick-up, maybe),
 * or, when Scout cannot think, a status mark shown as a row with Fix it and never spoken.
 */
export type GreetLine = { text: string; pickUp?: PickUpReadyParams } | { status: StatusId };

/** Whether the voice models are on disk, for the health check: a look, never a download. */
export interface VoiceModels {
  /** The local voice (Kokoro). */
  mouth: boolean;
  /** Every one of the ears' files. */
  ears: boolean;
}

/** A coding agent Welcome looked for on this computer. */
export interface FoundAgent {
  id: string;
  label: string;
  found: boolean;
  /** Whether the companion can think through this agent's sign-in, needing no key. */
  canThink: boolean;
}

/** The models a provider offers, and whether the list is the service's own. */
export interface ModelList {
  models: string[];
  source: 'live' | 'fallback';
}

/**
 * What a window reads about the host when it opens: settings, pets, brains and host facts.
 * Keys never come back out.
 */
export interface HostView {
  settings: Settings;
  /** Empty while the engine is down: pets live in its database. */
  pets: Pet[];
  providers: ProviderChoice[];
  engineVersion: string;
  /**
   * The token the Chrome extension pastes once to pair. Absent while the engine is down:
   * the engine owns the token file, and pairing against an engine that is not running
   * would only fail later, on the socket.
   */
  pairingToken?: string;
  /** Set when the global hotkey could not be registered, so settings can say why. */
  hotkeyError?: string;
  /** `process.platform`, so a hotkey reads Ctrl on Windows and Cmd on a Mac. */
  platform: string;
  /** Whether an ElevenLabs key is stored. The key itself never comes back out. */
  elevenLabsKeyStored: boolean;
}

/**
 * Host-only concerns, deliberately kept off `window.tagalong`.
 *
 * `window.tagalong` is exactly the HostBridge that @tagalong/ui knows how to consume;
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
  /** Whether rolling memory is recording now, for a window that just opened. */
  getRecording(): Promise<boolean>;
  /** Fires when rolling memory starts or stops: the avatar's red dot. */
  onRecording(handler: (recording: boolean) => void): () => void;
  getHostView(): Promise<HostView>;
  saveSettings(patch: SettingsPatch): Promise<Settings>;
  /** An empty key deletes the stored one. */
  saveApiKey(providerId: string, apiKey: string): Promise<void>;
  /** Welcome's one test of the key just saved for `providerId`. */
  checkKey(providerId: string): Promise<ProvidersCheckResult>;
  /** Opens a terminal that signs in to Claude Code; Welcome waits and checks again. */
  openClaudeSignIn(): Promise<void>;
  savePet(pet: Pet): Promise<Pet>;
  /** A click on Scout: opens its bubble, or gives the open bubble the keyboard back. */
  openBubble(): Promise<void>;
  listModels(providerId: string): Promise<ModelList>;
  /** Opens Settings, or the section or Home page a Fix it names. Main checks the target. */
  openSettings(target?: FixTarget): Promise<void>;
  /** Opens the Welcome window, from Settings › Advanced. */
  openWelcome(): Promise<void>;
  /** Opens Home, or focuses it. The tray's Open Tagalong is the shipped way in. */
  openHome(): Promise<void>;
  /** Main names the Home page to show, when the tray or the bubble opens a particular one. */
  onHomePage(handler: (page: string) => void): () => void;
  /**
   * Finishes Welcome: Scout becomes the Companion thinking on `providerId` and docks alone,
   * Welcome closes and the panel opens beside Scout.
   */
  finishWelcome(providerId: string): Promise<void>;
  /** Asks Claude Code, locally and with no model call, whether it is signed in. */
  checkClaudeSignIn(): Promise<ClaudeSignIn>;
  /**
   * Scout becomes the Companion thinking on `providerId`, on that provider's recommended
   * model. Settings calls it after storing a key when no Claude sign-in was found.
   */
  switchScout(providerId: string): Promise<Pet>;
  /**
   * Opens a provider's key page, or one of Welcome's install pages, in the browser. Main
   * refuses any other URL.
   */
  openLink(url: string): Promise<void>;
  hidePanel(): Promise<void>;
  /** The panel measured its content; main resizes it, keeping it level with the pet. */
  fitPanel(height: number): Promise<void>;
  /** Main asks the bubble for its one-time hello, right after Welcome. */
  onGreet(handler: () => void): () => void;
  /** Main hands the bubble the launch line, or the brain's status mark when Scout cannot think. */
  onGreetLine(handler: (line: GreetLine) => void): () => void;
  /** Main hands the bubble one line Scout says on its own, from keeping an eye on things. */
  onRemark(handler: (remark: PetRemarkParams) => void): () => void;
  /**
   * A routine's result, for the bubble: `line` shows the quiet line beside Scout, `speak`
   * says it aloud. Either may be false; main has already decided.
   */
  onRoutine(
    handler: (result: RoutineResultParams, how: { line: boolean; speak: boolean }) => void,
  ): () => void;
  /** Home opens on Routines with Scout's card in the form, from the card's Edit. */
  onRoutineDraft(handler: (proposal: RoutineProposedParams) => void): () => void;
  /** "Not now" on a remark: Scout stays quiet for an hour. */
  remarkNotNow(): Promise<void>;
  /** The person took a remark's offer: its brief goes to the hand-off card, unsent. */
  remarkAccept(remarkId: string): Promise<void>;
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
  /** Fires on every press of the talk key, repeats included, with when it fired. */
  onTalk(handler: (at: number) => void): () => void;
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
  /** The pointer overlay: a ring to draw. It only draws; nothing is clicked or typed. */
  onPointer(handler: (ring: PointerRing) => void): () => void;
  /**
   * Something was dropped on the figure. The preload turns each file into its path; main
   * names the item and opens the bubble on its card, reading nothing yet.
   */
  dropOnPet(drop: PetDrop): Promise<void>;
  /** Main hands the bubble the card for what was dropped on Scout. */
  onDrop(handler: (offer: DropOffer) => void): () => void;
  /** The health check: whether the voice models are on disk. Never downloads. */
  voiceModels(): Promise<VoiceModels>;
  /** The health check: whether the browser extension is connected to the engine. */
  hostsStatus(): Promise<{ extension: boolean }>;
  /** The top status mark now, for a window that just opened. */
  getStatusMark(): Promise<StatusMark | null>;
  /** Fires with the new top status mark, or null when none is left. */
  onStatusMark(handler: (mark: StatusMark | null) => void): () => void;
  /** Sets or clears one of the panel's own marks: the mic failing, or Say “Scout”. */
  setStatusMark(id: 'mic-busy' | 'mic-failed' | 'say-name', on: boolean): Promise<void>;
}

declare global {
  interface Window {
    tagalong: HostBridge;
    tagalongHost: TagalongHostApi;
  }
}
