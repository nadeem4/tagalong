import type { CaptureBlock } from '@tagalong/core';
import type { ContextSnapshot, Pet, Settings, SettingsPatch } from '@tagalong/protocol';
import type { HostBridge } from '@tagalong/ui';

/** Channel names, in one place so main and preload cannot drift apart. */
export const IPC = {
  ask: 'tagalong:ask',
  interrupt: 'tagalong:interrupt',
  listPets: 'tagalong:pets:list',
  listRoles: 'tagalong:roles:list',
  recommendModel: 'tagalong:roles:recommend-model',
  rolesNotice: 'tagalong:notices:roles-upgrade',
  dismissRolesNotice: 'tagalong:notices:dismiss-roles-upgrade',
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
  turnEvent: 'tagalong:turn-event',
  getContext: 'tagalong:context:get',
  capture: 'tagalong:capture',
  contextEvent: 'tagalong:context-event',
  hostView: 'tagalong:host:view',
  saveSettings: 'tagalong:settings:save',
  saveApiKey: 'tagalong:secret:api-key',
  savePet: 'tagalong:pets:save',
  listModels: 'tagalong:models:list',
  openSettings: 'tagalong:settings:open',
  hidePanel: 'tagalong:panel:hide',
  fitPanel: 'tagalong:panel:fit',
  greetEvent: 'tagalong:panel:greet',
  panelSideEvent: 'tagalong:panel:side',
  dragAvatar: 'tagalong:avatar:drag',
  dropAvatar: 'tagalong:avatar:drop',
  togglePanel: 'tagalong:panel:toggle',
  captureEvent: 'tagalong:capture-event',
  sightPauseEvent: 'tagalong:sight-pause-event',
  getSightPaused: 'tagalong:get-sight-paused',
  toggleSightPause: 'tagalong:toggle-sight-pause',
  hotkeyProblemEvent: 'tagalong:hotkey-problem-event',
  deletePet: 'tagalong:pets:delete',
  selectPet: 'tagalong:pets:select',
  activePetEvent: 'tagalong:active-pet-event',
  resizeStrip: 'tagalong:avatar:resize-strip',
  recordingEvent: 'tagalong:recording-event',
  getRecording: 'tagalong:get-recording',
  stopWatch: 'tagalong:watch:stop',
  openOnboarding: 'tagalong:onboarding:open',
  openOffice: 'tagalong:office:open',
  homePageEvent: 'tagalong:office:page',
  findAgents: 'tagalong:welcome:agents',
  finishWelcome: 'tagalong:welcome:finish',
  openLink: 'tagalong:link:open',
  showExtensionFolder: 'tagalong:extension:show',
  checkClaudeSignIn: 'tagalong:claude:sign-in',
  switchScout: 'tagalong:pets:switch-scout',
} as const;

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

/** One brain a pet can run on, as the settings window shows it. */
export interface ProviderChoice {
  id: string;
  label: string;
  /** Present for OpenAI-compatible presets: the URL used when settings name none. */
  defaultBaseUrl?: string;
  /** The variable `.env.example` lists for this key, for the form's hint. */
  envVar?: string;
  needsKey: boolean;
  /** Whether a key is stored. The key itself never comes back out. */
  hasKey: boolean;
}

/**
 * Whether Claude Code is signed in on this computer, from `claude auth status`.
 * `unknown` when claude ran but the answer could not be read (a timeout, odd output).
 */
export type ClaudeSignIn = 'signed-in' | 'signed-out' | 'not-installed' | 'unknown';

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

/** What the settings window needs to render. Keys never come back out. */
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
  /** Phase 3B. The check model a watch uses on each provider when a pet names none. */
  watchModelDefaults: Record<string, string>;
  /** Phase 7. `process.platform`, so a hotkey reads Ctrl on Windows and Cmd on a Mac. */
  platform: string;
  /** Phase 7. The unpacked Chrome extension's folder, when it is on this machine. */
  extensionFolder?: string;
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
  /**
   * Flips sight off or on, returning the state it moved to.
   *
   * The shipped surfaces are the hotkey and the tray item; this exists because a window
   * needs it too — settings will offer the toggle, and the smoke test drives the real
   * gate through it, which is the only check in the repo that fails when the gate is
   * left unwired.
   */
  toggleSightPause(): Promise<boolean>;
  /** Phase 3B. Whether rolling memory is recording now, for a window that just opened. */
  getRecording(): Promise<boolean>;
  /** Phase 3B. Fires when rolling memory starts or stops: the avatar's red dot. */
  onRecording(handler: (recording: boolean) => void): () => void;
  getHostView(): Promise<HostView>;
  saveSettings(patch: SettingsPatch): Promise<Settings>;
  /** An empty key deletes the stored one. */
  saveApiKey(providerId: string, apiKey: string): Promise<void>;
  savePet(pet: Pet): Promise<Pet>;
  /** Phase 4. Removes a pet for good; a deleted default pet is not re-seeded. */
  deletePet(petId: string): Promise<boolean>;
  /** Phase 4. A click on the crew strip: makes that pet the panel's and opens the panel. */
  selectPet(petId: string): Promise<void>;
  /** Phase 4. Fires in the panel when the strip picked a pet. */
  onActivePet(handler: (petId: string) => void): () => void;
  /** Phase 4. Sizes the avatar window to hold this many pets side by side. */
  resizeStrip(visiblePets: number): Promise<void>;
  listModels(providerId: string): Promise<ModelList>;
  openSettings(): Promise<void>;
  /** Opens the Welcome window, from Settings or the tray. */
  openOnboarding(): Promise<void>;
  /** Opens Home, or focuses it. The tray's Open Tagalong is the shipped way in. */
  openOffice(): Promise<void>;
  /** Main names the Home page to show, when the tray or the bubble opens a particular one. */
  onHomePage(handler: (page: string) => void): () => void;
  /** The coding agents on this computer, for Welcome's list. */
  findAgents(): Promise<FoundAgent[]>;
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
  /** Phase 7. Opens a provider's key page in the browser. Main refuses any other URL. */
  openLink(url: string): Promise<void>;
  /** Phase 7. Shows the unpacked extension's folder in the file manager. */
  showExtensionFolder(): Promise<void>;
  hidePanel(): Promise<void>;
  /** The panel measured its content; main resizes it, keeping it level with the pet. */
  fitPanel(height: number): Promise<void>;
  /** Main asks the bubble for its one-time hello, right after Welcome. */
  onGreet(handler: () => void): () => void;
  /** Which side of the pet the bubble sits on, so its tail points at the pet. */
  onPanelSide(handler: (side: 'left' | 'right') => void): () => void;
  /** Moves the pet by a drag's step; the bubble follows. */
  dragAvatar(dx: number, dy: number): Promise<void>;
  /** The drag ended: remember where the pet was left. */
  dropAvatar(): Promise<void>;
  togglePanel(): Promise<void>;
}

declare global {
  interface Window {
    tagalong: HostBridge;
    tagalongHost: TagalongHostApi;
  }
}
