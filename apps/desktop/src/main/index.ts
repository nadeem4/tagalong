import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  ipcMain,
  screen,
  shell,
} from 'electron';
import {
  ConnectionsAddParams,
  ContextSnapshot,
  HandoffFinishedParams,
  RoutineDraft,
  RoutineResultParams,
} from '@tagalong/protocol';
import type {
  Expert,
  PerceptionTarget,
  Pet,
  Role,
  RoutineDraftInput,
  RoutineProposedParams,
  Settings,
  SettingsPatch,
} from '@tagalong/protocol';
import { SettingsStore, WATCH_MODEL_DEFAULTS, getRole } from '@tagalong/core';
import { systemClock } from './awareness/clock';
import { handoffNotice } from './handoff-notice';
import { routineDelivery } from './routine-delivery';
import { nativeCodec } from './awareness/native-codec';
import { PerceptionMemory } from './awareness/perception-memory';
import { RollingMemory } from './awareness/rolling-memory';
import { captureNotice, captureTooltip } from './capture-notice';
import { captureAskSnapshot, capturePatch } from './context';
import { startEngineHost } from './engine-host';
import { keepAnEyeAllowed, startKeepAnEye } from './keep-an-eye';
import { extensionFolder, isAllowedLink } from './links';
import { ELEVENLABS_SECRET_KEY, providerChoices, secretKeyFor } from './provider-choices';
import { elevenLabsTts } from './voice/elevenlabs';
import { loadKokoro } from './voice/kokoro';
import { LazyLocalVoice, createVoiceService } from './voice/voice';
import type { VoiceService } from './voice/voice';
import { LazyLocalStt, createListenService } from './voice/listen';
import type { ListenService } from './voice/listen';
import { loadWhisper } from './voice/whisper';
import { checkClaudeSignIn } from './claude-sign-in';
import {
  companionOn,
  findAgents,
  shouldGreetOnLaunch,
  shouldOpenWelcome,
  welcomeCrew,
  welcomeExperts,
} from './welcome';
import type { EngineHost } from './engine-host';
import {
  DEFAULT_PAUSE_SIGHT_HOTKEY,
  DEFAULT_STOP_VOICE_HOTKEY,
  DEFAULT_TALK_HOTKEY,
  HotkeyManager,
  describeHotkeyProblems,
} from './hotkeys';
import { createPlatform } from './platform/index';
import { gateSight } from './platform/sight-gate';
import { SightPause } from './sight-pause';
import type { Platform } from './platform/index';
import { SafeStorageSecretStore } from './secret-store';
import { createTrayIcon } from './tray-icon';
import { trayMenuTemplate } from './tray-menu';
import { createAvatarWindow } from './windows/avatar';
import {
  createPanelWindow,
  fitPanel,
  placePanel,
  showPanelBeside,
  showPanelQuietly,
} from './windows/panel';
import { AVATAR_SIZE, resolveAvatarPosition, stripWidth } from './windows/position';
import { moveWindow } from './windows/move';
import { createOfficeWindow } from './windows/office';
import { createOnboardingWindow } from './windows/onboarding';
import { createSettingsWindow } from './windows/settings';
import { IPC } from '../shared/ipc';
import type { CaptureNotice, HostView, ModelList, SpeakPreview } from '../shared/ipc';
import type { ConfirmHandoff } from '@tagalong/ui';

/** Everything the app owns once it is up. Assembled in `start`, torn down on quit. */
interface Desktop {
  /** Null when the engine refused to boot — see `start` for why that is survivable. */
  host: EngineHost | null;
  bootError: string | null;
  platform: Platform;
  settingsStore: SettingsStore;
  /** The settings the running app is using; refreshed whenever they are saved. */
  settings: Settings;
  secrets: SafeStorageSecretStore;
  avatar: BrowserWindow | null;
  panel: BrowserWindow | null;
  tray: Tray;
  settingsWindow: BrowserWindow | null;
  /** Phase 7: the setup wizard, while it is open. */
  onboardingWindow: BrowserWindow | null;
  /** Scout is hidden until the first Welcome is done. */
  scoutWaits: boolean;
  /** The Crew Office, while it is open. */
  officeWindow: BrowserWindow | null;
  /** The snapshot the last hotkey captured, handed to the panel and sent with the ask. */
  pendingSnapshot: ContextSnapshot | null;
  /** Turn ids in flight: the panel must not vanish on focus loss mid-answer. */
  activeTurns: Set<string>;
  hotkeys: HotkeyManager;
  hotkeyError: string | null;
  /** Whether the user has sight turned off. Read by the platform gate on every read. */
  sightPause: SightPause;
  /** Phase 3B: the last few minutes of the screen, in memory, opt-in. */
  rolling: RollingMemory;
  /** Phase 3B: answers perception.recall and perception.diff. */
  perceptionMemory: PerceptionMemory;
  /** Turns Scout's lines into audio for the panel to play. */
  voice: VoiceService;
  /** Talk to Scout: turns what the panel recorded into text, on this computer. */
  listen: ListenService;
}

let desktop: Desktop | null = null;

/**
 * A second launch focuses the pet that is already running.
 *
 * Two engines would fight over the same port and the same SQLite file, so the lock is
 * taken before anything else happens.
 */
// The fake ears need no real microphone: Chromium's fake device stands in for one, and
// the permission prompt answers itself. Switches only take effect before the app is ready.
if (process.env.TAGALONG_FAKE_STT === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPets());

  app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      // .then(start, handler) would not catch a rejection from start itself.
      dialog.showErrorBox('Tagalong could not start', String(error));
      app.quit();
    });
}

// The pets live in the tray, so closing a window is never a reason to quit.
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  desktop?.hotkeys.dispose();
  stopKeepAnEye();
  // Memory only, and gone on quit: nothing here was ever written anywhere to clean up.
  desktop?.rolling.dispose();
  desktop?.perceptionMemory.clear();
  void desktop?.host?.shutdown();
});

async function start(): Promise<void> {
  const sightPause = new SightPause();
  // Gated at the source, so every present and future reader is covered by construction.
  // Nothing downstream is handed the ungated adapter, which is what makes forgetting to
  // consult the pause impossible rather than merely discouraged.
  const platform = gateSight(createPlatform(), () => sightPause.paused);
  const dataDir = app.getPath('userData');
  const secrets = new SafeStorageSecretStore(dataDir);
  const settingsStore = new SettingsStore(dataDir);

  const settings = settingsStore.get();

  const rolling = new RollingMemory({
    platform,
    clock: systemClock,
    exclusions: () => desktop?.settings.captureExclusions ?? settings.captureExclusions,
    isPaused: () => sightPause.paused,
    onRecordingChange: (recording) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.recordingEvent, recording);
      }
    },
    log: (message) => console.log(`[rolling-memory] ${message}`),
  });
  const perceptionMemory = new PerceptionMemory({
    rolling,
    platform,
    codec: nativeCodec,
    clock: systemClock,
    exclusions: () => desktop?.settings.captureExclusions ?? settings.captureExclusions,
  });

  let host: EngineHost | null = null;
  let bootError: string | null = null;
  try {
    host = await startEngineHost({
      dataDir,
      secrets,
      platform,
      onNotification: forwardToRenderers,
      captureExclusions: () => desktop?.settings.captureExclusions ?? settings.captureExclusions,
      onCapture: announceCapture,
      recall: (params) => perceptionMemory.recall(params),
      diff: (params) => perceptionMemory.diff(params),
    });
  } catch (error) {
    // A missing API key is the ordinary first run, not a crash. Quitting here would leave
    // the user with no way to reach the settings window that fixes it.
    bootError = error instanceof Error ? error.message : String(error);
    console.error('[main] the engine did not start:', bootError);
  }

  desktop = {
    host,
    bootError,
    platform,
    settingsStore,
    settings,
    secrets,
    avatar: null,
    panel: null,
    tray: createTray(),
    settingsWindow: null,
    onboardingWindow: null,
    scoutWaits: false,
    officeWindow: null,
    pendingSnapshot: null,
    activeTurns: new Set(),
    hotkeys: new HotkeyManager({
      onAsk: () => void openPanelWithContext(),
      onPauseSight: () => toggleSightPause(),
      onStopVoice: () => stopVoice(),
      onTalk: () => talkPressed(),
    }),
    hotkeyError: null,
    sightPause,
    rolling,
    perceptionMemory,
    voice: createVoiceService({
      env: process.env,
      settings: () => (desktop?.settings ?? settings).voice,
      elevenLabsKey: () => secrets.get(ELEVENLABS_SECRET_KEY).catch(() => null),
      // The model downloads into the data dir on first use, never at start.
      local: new LazyLocalVoice(() => loadKokoro(join(dataDir, 'voice'))),
      elevenLabs: (apiKey, voiceId) => elevenLabsTts(apiKey, voiceId),
    }),
    // The speech model downloads beside the voice, on the first Talk to Scout.
    listen: createListenService({
      env: process.env,
      local: new LazyLocalStt(() => loadWhisper(join(dataDir, 'voice'))),
    }),
  };

  rolling.configure(settings.rollingMemory);

  // The avatar greys its eye and the tray shows a checkmark, so both follow one state
  // rather than each remembering to ask.
  sightPause.onChange((paused) => {
    // A pause stops rolling memory and drops every frame either ring held.
    rolling.pauseChanged(paused);
    if (paused) perceptionMemory.clear();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.sightPauseEvent, paused);
    }
    desktop?.tray.setContextMenu(buildTrayMenu());
    desktop?.tray.setToolTip(paused ? 'Tagalong — sight is paused' : 'Tagalong');
  });

  registerIpc();

  if (host === null) {
    openSettings();
    dialog.showErrorBox(
      'Tagalong started without its engine',
      `${bootError}\n\nSettings is open so you can fix it. Restart Tagalong afterwards.`,
    );
    return;
  }

  desktop.panel = createPanelWindow({
    isStreaming: () => (desktop?.activeTurns.size ?? 0) > 0,
    pet: () => desktop?.avatar ?? null,
  });
  // A new install starts in Welcome alone; Scout arrives when Welcome is done.
  const welcoming = shouldOpenWelcome(settings, process.env);
  desktop.scoutWaits = welcoming;
  desktop.avatar = createAvatarWindow({
    hidden: welcoming,
    position: settings.avatar,
    onMoved: (position) => {
      void host.client
        .call('settings.set', { patch: { avatar: position } })
        .catch((error: unknown) => console.warn('[main] could not persist avatar position', error));
    },
  });

  // Deliberately not a modal, and deliberately not fatal. The only way to store an
  // accelerator that cannot be registered is to type it into Settings, so refusing to
  // start because of it leaves the user locked out of the one window that could fix it,
  // with the settings file as the only way back. The manager binds each key
  // independently, so the others are already live; the failure is surfaced in the panel
  // and in Settings, where there is something to do about it.
  applyHotkeys(settings);

  // A fresh install starts in Welcome: the agents found here, how Scout thinks, one key.
  // Finishing it is remembered in settings; Home opens it again.
  if (welcoming) openOnboarding();
  else void greetOnLaunch(host);

  // Keep an eye on things: window titles go to the engine every five seconds, never a
  // picture. Off in Settings, or while sight is paused, nothing is listed at all.
  if (keepAnEyeAllowed(process.env)) {
    stopKeepAnEye = startKeepAnEye({
      enabled: () => (desktop?.settings.keepAnEye ?? false) && !sightPause.paused,
      list: async () => {
        const exclusions = desktop?.settings.captureExclusions ?? settings.captureExclusions;
        return (await platform.listWindows(exclusions, { countText: false })).windows;
      },
      send: (windows) => host.client.call('keepAnEye.observe', { windows }),
    });
  }
}

/** Stops the keep-an-eye timer on quit. */
let stopKeepAnEye = (): void => undefined;

/**
 * Scout has one thing to say from keeping an eye on things: one quiet line beside the pet,
 * without taking the keyboard. Not while the bubble is already open: the person is busy
 * with it, and a remark is never worth interrupting them for.
 */
function showRemark(params: unknown): void {
  const panel = desktop?.panel;
  const avatar = desktop?.avatar;
  if (panel == null || avatar == null || !avatar.isVisible() || panel.isVisible()) return;
  panel.webContents.send(IPC.remarkEvent, params);
  showPanelQuietly(panel, avatar);
  // The panel says the remark aloud like any bubble line: shortened, one at a time, and
  // silent when Scout talks is off. Speech lives in the panel, which owns the queue and stop.
}

/**
 * A later launch: Scout says one line beside itself without taking the keyboard, and the
 * launch is remembered so the next one knows how long you were away. The line reads no
 * screen, and the engine falls back to a handwritten one, so this never waits on a brain.
 */
async function greetOnLaunch(host: EngineHost): Promise<void> {
  const current = desktop;
  if (current === null) return;
  try {
    if (shouldGreetOnLaunch(current.settings)) {
      const { text } = await host.client.call('greeting.compose', {
        petId: current.settings.defaultPetId,
      });
      const { panel, avatar } = current;
      if (panel !== null && avatar !== null && avatar.isVisible() && !panel.isVisible()) {
        if (panel.webContents.isLoading()) {
          await new Promise<void>((resolve) => panel.webContents.once('did-finish-load', resolve));
        }
        panel.webContents.send(IPC.greetLineEvent, text);
        showPanelQuietly(panel, avatar);
      }
    }
  } catch (error) {
    console.warn('[main] the greeting did not run:', error);
  }
  try {
    const patch: SettingsPatch = { lastOpenedAt: new Date().toISOString() };
    current.settings = (await host.client.call('settings.set', { patch })).settings;
  } catch (error) {
    console.warn('[main] could not remember this launch:', error);
  }
}

/**
 * Binds both hotkeys to what settings currently say, and reports what was refused.
 *
 * Called again on every settings save, which is what makes a rebind take effect without
 * a restart: the manager releases only the accelerator that changed.
 */
function applyHotkeys(settings: Settings): string | null {
  if (desktop === null) return null;
  const outcomes = desktop.hotkeys.apply({
    ask: settings.hotkeys.ask,
    pauseSight: settings.hotkeys.pauseSight ?? DEFAULT_PAUSE_SIGHT_HOTKEY,
    stopVoice: settings.hotkeys.stopVoice ?? DEFAULT_STOP_VOICE_HOTKEY,
    talk: settings.hotkeys.talk ?? DEFAULT_TALK_HOTKEY,
  });

  desktop.hotkeyError = describeHotkeyProblems(outcomes);
  if (desktop.hotkeyError !== null) console.error(`[main] ${desktop.hotkeyError}`);

  // Broadcast rather than wait for the next getHostView. The panel may already be open,
  // and a window still showing a problem the user has just fixed is the same kind of lie
  // as never showing it at all.
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.hotkeyProblemEvent, desktop.hotkeyError);
  }
  return desktop.hotkeyError;
}

/**
 * The talk key, on every press, repeats included: the bubble comes up with the keyboard, so
 * it sees the key come up, and the panel tells a held key from a fresh press. The
 * microphone only ever opens in the panel, on this key or its mic button.
 */
function talkPressed(): void {
  if (desktop === null || desktop.panel === null || desktop.avatar === null) return;
  const { panel, avatar } = desktop;
  if (!panel.isVisible() || !panel.isFocused()) {
    avatar.show();
    showPanelBeside(panel, avatar);
  }
  panel.webContents.send(IPC.talkEvent, Date.now());
}

/** The stop key: every window that is speaking stops at once and drops what it had queued. */
function stopVoice(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.stopVoiceEvent);
  }
}

/** Re-renders the crew strip after the crew or its visibility changed in Settings. */
function refreshStrip(): void {
  const avatar = desktop?.avatar;
  if (avatar !== null && avatar !== undefined && !avatar.isDestroyed()) avatar.webContents.reload();
}

/** Turn notifications drive the UI, and main is the only thing holding the socket. */
function forwardToRenderers(notification: { method: string; params: unknown }): void {
  const params = (notification.params ?? {}) as { turnId?: string };
  if (notification.method === 'turn.started' && params.turnId !== undefined) {
    desktop?.activeTurns.add(params.turnId);
  }
  if (
    (notification.method === 'turn.completed' || notification.method === 'turn.error') &&
    params.turnId !== undefined
  ) {
    desktop?.activeTurns.delete(params.turnId);
  }

  if (notification.method === 'watch.fired') announceWatch(notification.params);
  if (notification.method === 'handoff.finished') announceHandoff(notification.params);
  if (notification.method === 'pet.remark') showRemark(notification.params);
  // A brief to check: the bubble comes up beside the pet with the card in it.
  if (notification.method === 'handoff.proposed') bringUpBubble(true);
  // A change Scout wants to make in a connected app: the confirm card must be seen.
  if (notification.method === 'connector.confirm') bringUpBubble(true);
  // A routine Scout wrote: the card waits in the bubble for Save.
  if (notification.method === 'routine.proposed') bringUpBubble(true);
  if (notification.method === 'routine.result') deliverRoutine(notification.params);

  // The renderer speaks the UI package's TurnEvent shape: the wire params plus the
  // method as a discriminant.
  const event = { type: notification.method, ...params };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.turnEvent, event);
  }
}

/**
 * A watch fired: say so where the user will see it. The panel gets the message as a card
 * through the ordinary event forward; this adds a system toast and brings the panel up
 * beside the avatar. The panel says the message aloud when Scout talks is on.
 */
function announceWatch(params: unknown): void {
  const { message } = (params ?? {}) as { message?: string };
  if (message !== undefined && Notification.isSupported()) {
    new Notification({ title: 'Tagalong — a watch fired', body: message, silent: false }).show();
  }
  if (desktop?.panel != null && desktop.avatar != null && !desktop.panel.isVisible()) {
    showPanelBeside(desktop.panel, desktop.avatar);
  }
}

/**
 * An expert finished a hand-off: the bubble comes up beside the pet with the answer,
 * without taking the keyboard. A system notification says so too when the pets are hidden,
 * since then there is no bubble to see.
 */
function announceHandoff(params: unknown): void {
  const parsed = HandoffFinishedParams.safeParse(params);
  if (!parsed.success) return;
  if (desktop?.avatar?.isVisible() === true) {
    bringUpBubble(false);
    return;
  }
  const notice = handoffNotice(parsed.data);
  if (notice !== null && Notification.isSupported()) {
    new Notification({ ...notice, silent: false }).show();
  }
}

/**
 * A routine ran: the quiet line beside Scout, its voice, a Windows notification, as the
 * routine chose (Activity already has it). The engine held it while a call or a full-screen
 * app was in front. Clicking the notification opens the bubble on the full answer.
 */
function deliverRoutine(params: unknown): void {
  const parsed = RoutineResultParams.safeParse(params);
  const current = desktop;
  if (!parsed.success || current === null) return;
  const result = parsed.data;
  const { panel, avatar } = current;
  const how = routineDelivery(result, {
    avatarVisible: avatar?.isVisible() === true,
    panelVisible: panel?.isVisible() === true,
  });
  if (panel !== null && (how.line || how.speak)) {
    panel.webContents.send(IPC.routineEvent, result, { line: how.line, speak: how.speak });
    if (how.line && avatar !== null) showPanelQuietly(panel, avatar);
  }
  if (how.notice !== null && Notification.isSupported()) {
    const notice = new Notification({ ...how.notice, silent: false });
    notice.on('click', () => {
      const shown = desktop;
      if (shown?.panel == null || shown.avatar == null) return;
      shown.avatar.show();
      shown.panel.webContents.send(IPC.routineEvent, result, { line: true, speak: false });
      showPanelBeside(shown.panel, shown.avatar);
    });
    notice.show();
  }
}

/** Shows the bubble if it is hidden; `focus` gives it the keyboard, for something to answer. */
function bringUpBubble(focus: boolean): void {
  const panel = desktop?.panel;
  const avatar = desktop?.avatar;
  if (panel == null || avatar == null || panel.isVisible()) return;
  if (focus) showPanelBeside(panel, avatar);
  else showPanelQuietly(panel, avatar);
}

function showPets(): void {
  if (desktop === null) return;
  desktop.avatar?.show();
  if (desktop.panel !== null && desktop.avatar !== null) {
    showPanelBeside(desktop.panel, desktop.avatar);
  }
}

/**
 * Flips sight off or on, from either the hotkey or the tray.
 *
 * The tray carries the same action as the hotkey because this is the one hotkey whose
 * loss matters: a user who needs to blind the pet right now must not first discover that
 * something else on their machine owns the combination.
 */
function toggleSightPause(): boolean {
  return desktop?.sightPause.toggle() ?? false;
}

/** Rebuilt whenever pause flips, so the checkmark cannot drift from the real state. */
function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate(
    trayMenuTemplate(
      {
        togglePets: () => {
          if (desktop?.avatar === null || desktop === null) return;
          if (desktop.avatar?.isVisible() === true) {
            desktop.avatar.hide();
            desktop.panel?.hide();
          } else {
            desktop.avatar?.show();
          }
        },
        toggleSightPause: () => void toggleSightPause(),
        openOffice: () => openOffice(),
        quit: () => app.quit(),
      },
      { sightPaused: desktop?.sightPause.paused ?? false },
    ),
  );
}

function createTray(): Tray {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip('Tagalong');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => void openPanelWithContext());
  return tray;
}

function openSettings(): void {
  if (desktop === null) return;
  if (desktop.settingsWindow !== null && !desktop.settingsWindow.isDestroyed()) {
    desktop.settingsWindow.focus();
    return;
  }
  const window = createSettingsWindow();
  window.on('closed', () => {
    if (desktop !== null) desktop.settingsWindow = null;
  });
  desktop.settingsWindow = window;
}

/**
 * Opens Home, or brings the open one forward, on `page` when one is named (Settings, say).
 * A fresh window is told its page once it has loaded.
 */
function openOffice(page?: string): void {
  if (desktop === null) return;
  const open = desktop.officeWindow;
  if (open !== null && !open.isDestroyed()) {
    if (page !== undefined) open.webContents.send(IPC.homePageEvent, page);
    open.focus();
    return;
  }
  const window = createOfficeWindow();
  window.on('closed', () => {
    if (desktop !== null) desktop.officeWindow = null;
  });
  if (page !== undefined) {
    window.webContents.once('did-finish-load', () =>
      window.webContents.send(IPC.homePageEvent, page),
    );
  }
  desktop.officeWindow = window;
}

/**
 * Settings is a page of Home. The standalone Settings window only opens when the engine
 * failed to start, since Home cannot work without it.
 */
function openSettingsPage(): void {
  if (desktop?.host === null) openSettings();
  else openOffice('settings');
}

/** Opens the setup wizard, or brings the open one forward. */
function openOnboarding(): void {
  if (desktop === null) return;
  if (desktop.onboardingWindow !== null && !desktop.onboardingWindow.isDestroyed()) {
    desktop.onboardingWindow.focus();
    return;
  }
  const window = createOnboardingWindow();
  window.on('closed', () => {
    if (desktop === null) return;
    desktop.onboardingWindow = null;
    // Closed without Start, Scout still arrives: an install never ends with nothing on screen.
    // Only the first Welcome hides it, so this never undoes the tray's Hide Scout.
    if (desktop.scoutWaits) desktop.avatar?.show();
    desktop.scoutWaits = false;
  });
  desktop.onboardingWindow = window;
}

/** Where the unpacked Chrome extension is on this machine, if anywhere. */
function localExtensionFolder(): string | undefined {
  return extensionFolder({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    exists: existsSync,
  });
}

/**
 * Tells everyone that a capture just happened.
 *
 * Both surfaces matter: the avatar badges the moment itself, and the tray keeps the
 * record with its time, so nothing Tagalong reads from the screen is ever unannounced.
 */
function announceCapture(notice: CaptureNotice): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.captureEvent, notice);
  }
  desktop?.tray.setToolTip(captureTooltip(notice));
}

/**
 * The ask hotkey: read the selection and the window you are on before the bubble takes the
 * focus, announce it, then open the bubble with what was found. No picture rides along:
 * Scout takes a screenshot or reads other windows itself, when a question needs them.
 */
async function openPanelWithContext(): Promise<void> {
  if (desktop === null || desktop.panel === null || desktop.avatar === null) return;

  const { snapshot, blocked, paused } = await captureAskSnapshot(desktop.platform, {
    screenshot: false,
    exclusions: desktop.settings.captureExclusions,
  });
  desktop.pendingSnapshot = snapshot;

  announceCapture(captureNotice({ at: new Date(), screenshot: false, blocked, paused }));
  desktop.panel.webContents.send(IPC.contextEvent, snapshot);
  desktop.avatar.show();
  showPanelBeside(desktop.panel, desktop.avatar);
}

/**
 * A click on the pet: the bubble opens at once, with nothing captured. The click has just
 * put the pet's own window in front, so a selection copy or a window read would wait on
 * the keyboard and the clipboard only to find Tagalong itself. The hotkeys still capture.
 */
function openPanelNow(current: Desktop): void {
  if (current.panel === null || current.avatar === null) return;
  current.pendingSnapshot = null;
  current.panel.webContents.send(IPC.contextEvent, null);
  current.avatar.show();
  showPanelBeside(current.panel, current.avatar);
}

/**
 * The panel's own capture button. Null means refused, which is how the panel learns to
 * say capture is blocked here rather than silently staying blind.
 */
async function captureForPanel(
  current: Desktop,
  targets: readonly PerceptionTarget[],
): Promise<ContextSnapshot | null> {
  const { patch, blocked, paused } = await capturePatch(current.platform, targets, {
    exclusions: current.settings.captureExclusions,
  });
  announceCapture(
    captureNotice({ at: new Date(), screenshot: targets.includes('screenshot'), blocked, paused }),
  );
  // Null is how the panel learns to say why it is blind. Paused and blocked are different
  // sentences, and the notice above carries which one it was.
  if (blocked !== null || paused) return null;

  const snapshot = ContextSnapshot.parse({
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    host: 'desktop',
    ...patch,
  });
  current.pendingSnapshot = snapshot;
  current.panel?.webContents.send(IPC.contextEvent, snapshot);
  return snapshot;
}

function registerIpc(): void {
  const required = (): Desktop => {
    if (desktop === null) throw new Error('the desktop host is not ready yet');
    return desktop;
  };

  /** Anything that needs a turn to run needs the engine that runs it. */
  const engine = (): EngineHost => {
    const current = required();
    if (current.host === null) {
      throw new Error(current.bootError ?? 'the engine is not running');
    }
    return current.host;
  };

  /** Settings still work with no engine, which is the whole point of the degraded mode. */
  const readSettings = async (): Promise<Settings> => {
    const current = required();
    if (current.host === null) return current.settingsStore.get();
    return (await current.host.client.call('settings.get', {})).settings;
  };

  ipcMain.handle(
    IPC.ask,
    async (
      _event,
      input: { petId: string; conversationId?: string; text?: string; spoken?: boolean },
    ) => {
      const snapshot = required().pendingSnapshot;
      return engine().client.call('ask', {
        petId: input.petId,
        ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
        input: { text: input.text ?? '' },
        ...(snapshot !== null ? { snapshot } : {}),
        ...(input.spoken === true ? { spoken: true } : {}),
      });
    },
  );

  ipcMain.handle(IPC.stopWatch, async (_event, watchId: string) => {
    await engine().client.call('watch.stop', { watchId });
  });

  ipcMain.handle(IPC.interrupt, async (_event, turnId: string) => {
    await engine().client.call('interrupt', { turnId });
  });

  ipcMain.handle(IPC.listPets, async (): Promise<Pet[]> => {
    const result = await engine().client.call('pets.list', {});
    return result.pets;
  });

  ipcMain.handle(IPC.listRoles, async (): Promise<Role[]> => {
    const result = await engine().client.call('roles.list', {});
    return result.roles;
  });

  ipcMain.handle(IPC.recommendModel, async (_event, roleId: string, providerId: string) =>
    engine().client.call('roles.recommendModel', { roleId, providerId }),
  );

  ipcMain.handle(IPC.rolesNotice, async () => {
    const result = await engine().client.call('notices.rolesUpgrade', {});
    return result.notice;
  });

  ipcMain.handle(IPC.dismissRolesNotice, async (): Promise<void> => {
    await engine().client.call('notices.dismiss', { notice: 'rolesUpgrade' });
  });

  // Home's activity view.
  ipcMain.handle(IPC.listActivity, async (_event, params: { before?: string; limit?: number }) =>
    engine().client.call('activity.list', {
      limit: params.limit ?? 30,
      ...(params.before === undefined ? {} : { before: params.before }),
    }),
  );

  // Home's Experts tab.
  ipcMain.handle(IPC.listExperts, async (): Promise<Expert[]> => {
    const result = await engine().client.call('experts.list', {});
    return result.experts;
  });
  ipcMain.handle(IPC.saveExpert, async (_event, expert: Expert): Promise<Expert> => {
    const result = await engine().client.call('experts.upsert', { expert });
    return result.expert;
  });
  ipcMain.handle(IPC.deleteExpert, async (_event, expertId: string): Promise<boolean> => {
    const result = await engine().client.call('experts.delete', { expertId });
    return result.deleted;
  });
  ipcMain.handle(IPC.testExpert, async (_event, expertId: string) =>
    engine().client.call('experts.test', { expertId }),
  );
  ipcMain.handle(IPC.pickFolder, async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = { title: 'Choose a project folder', properties: ['openDirectory' as const] };
    const picked = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    // The dialog took focus, which hides the bubble; bring it back with the folder in it.
    const { panel, avatar } = required();
    if (owner !== null && owner === panel && avatar !== null) showPanelBeside(panel, avatar);
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.confirmHandoff, async (_event, params: ConfirmHandoff) =>
    engine().client.call('handoffs.confirm', params),
  );
  ipcMain.handle(IPC.dismissHandoff, async (_event, proposalId: string) => {
    await engine().client.call('handoffs.dismiss', { proposalId });
  });
  ipcMain.handle(IPC.cancelHandoff, async (_event, handoffId: string) => {
    await engine().client.call('handoffs.cancel', { handoffId });
  });
  ipcMain.handle(IPC.searchProjects, async (_event, query: string) => {
    const { projects } = await engine().client.call('projects.search', { query });
    return projects;
  });

  // Connected apps, and the answer to a change Scout asked to make in one.
  ipcMain.handle(IPC.approveTool, async (_event, approvalId: string, decision: 'once' | 'deny') => {
    await engine().client.call('tool.approve', { approvalId, decision });
  });
  ipcMain.handle(IPC.listConnections, async () => engine().client.call('connections.list', {}));
  ipcMain.handle(IPC.addConnection, async (_event, params: ConnectionsAddParams) => {
    // Parsed here so the defaults (no args, no env) are filled before the call goes out.
    const { connection } = await engine().client.call(
      'connections.add',
      ConnectionsAddParams.parse(params),
    );
    return connection;
  });
  ipcMain.handle(IPC.setConnectionEnabled, async (_event, id: string, enabled: boolean) => {
    const { connection } = await engine().client.call('connections.setEnabled', { id, enabled });
    return connection;
  });
  ipcMain.handle(IPC.signInConnection, async (_event, id: string) => {
    const { connection } = await engine().client.call('connections.signIn', { id });
    return connection;
  });
  ipcMain.handle(IPC.removeConnection, async (_event, id: string) => {
    const { removed } = await engine().client.call('connections.remove', { id });
    return removed;
  });

  // Home's Routines page and the routine card. Saving, here or on the card, is consent.
  ipcMain.handle(IPC.listRoutines, async () => {
    const { routines } = await engine().client.call('routines.list', {});
    return routines;
  });
  ipcMain.handle(IPC.saveRoutine, async (_event, routine: RoutineDraftInput & { id?: string }) => {
    const { routine: saved } = await engine().client.call('routines.save', {
      routine: { ...RoutineDraft.parse(routine), ...(routine.id ? { id: routine.id } : {}) },
    });
    return saved;
  });
  ipcMain.handle(IPC.deleteRoutine, async (_event, id: string) => {
    const { deleted } = await engine().client.call('routines.delete', { id });
    return deleted;
  });
  ipcMain.handle(IPC.setRoutineEnabled, async (_event, id: string, enabled: boolean) => {
    const { routine } = await engine().client.call('routines.setEnabled', { id, enabled });
    return routine;
  });
  ipcMain.handle(IPC.runRoutine, async (_event, id: string) => {
    const { started } = await engine().client.call('routines.runNow', { id });
    return started;
  });
  ipcMain.handle(
    IPC.confirmRoutine,
    async (_event, proposalId: string, routine?: RoutineDraftInput) =>
      engine().client.call('routines.confirm', {
        proposalId,
        ...(routine !== undefined ? { routine: RoutineDraft.parse(routine) } : {}),
      }),
  );
  ipcMain.handle(IPC.dismissRoutine, async (_event, proposalId: string) => {
    await engine().client.call('routines.dismiss', { proposalId });
  });
  // The card's Edit: Home opens on Routines with the card's routine in the form.
  ipcMain.handle(IPC.editRoutine, (_event, proposal: RoutineProposedParams) => {
    openOffice('routines');
    const window = required().officeWindow;
    if (window === null) return;
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () =>
        window.webContents.send(IPC.routineDraftEvent, proposal),
      );
    } else window.webContents.send(IPC.routineDraftEvent, proposal);
  });

  ipcMain.handle(IPC.getContext, () => required().pendingSnapshot);
  // A window that opened after the last toggle has missed the event, and an avatar that
  // shows sight running while it is paused is the one lie this feature cannot afford.
  ipcMain.handle(IPC.getSightPaused, () => required().sightPause.paused);
  ipcMain.handle(IPC.getRecording, () => required().rolling.recording);
  ipcMain.handle(IPC.toggleSightPause, () => {
    required();
    return toggleSightPause();
  });

  ipcMain.handle(IPC.capture, async (_event, targets: PerceptionTarget[]) =>
    captureForPanel(required(), targets),
  );

  ipcMain.handle(IPC.hostView, async (): Promise<HostView> => {
    const current = required();
    const settings = await readSettings();
    const stored = new Set<string>();
    for (const choice of providerChoices(new Set())) {
      const secretKey = secretKeyFor(choice.id);
      if (secretKey === undefined) continue;
      const value = await current.secrets.get(secretKey);
      if (value !== null && value.length > 0) stored.add(choice.id);
    }
    // Pets live in the engine's database; with no engine the form shows keys and URLs
    // only, which is exactly what someone fixing a failed boot needs.
    const pets =
      current.host === null ? [] : (await current.host.client.call('pets.list', {})).pets;
    const problem = current.hotkeyError ?? current.bootError;
    const folder = localExtensionFolder();
    const elevenLabsKey = await current.secrets.get(ELEVENLABS_SECRET_KEY).catch(() => null);
    return {
      elevenLabsKeyStored: elevenLabsKey !== null && elevenLabsKey.length > 0,
      settings,
      pets,
      providers: providerChoices(stored),
      engineVersion: app.getVersion(),
      watchModelDefaults: { ...WATCH_MODEL_DEFAULTS },
      platform: process.platform,
      ...(folder !== undefined ? { extensionFolder: folder } : {}),
      ...(current.host !== null ? { pairingToken: current.host.engine.pairingToken } : {}),
      ...(problem !== null ? { hotkeyError: problem } : {}),
    };
  });

  ipcMain.handle(IPC.saveSettings, async (_event, patch: SettingsPatch): Promise<Settings> => {
    const current = required();
    const saved =
      current.host === null
        ? current.settingsStore.set(patch)
        : (await current.host.client.call('settings.set', { patch })).settings;

    // Rebinding here is the whole point: a hotkey the user just typed has to work now,
    // not after a restart.
    current.settings = saved;
    if (patch.hotkeys !== undefined) applyHotkeys(saved);
    if (patch.hiddenPets !== undefined) refreshStrip();
    // Home's Desktop pet control: the desktop redraws on the pet it now shows.
    if (patch.defaultPetId !== undefined) refreshStrip();
    // Rolling memory starts, stops or trims the moment the user saves, not after a restart.
    if (patch.rollingMemory !== undefined) current.rolling.configure(saved.rollingMemory);
    // An open panel reads its keys, microphone and the user's name from here, not a restart.
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.settingsChangedEvent, saved);
    }
    return saved;
  });

  ipcMain.handle(IPC.saveApiKey, async (_event, providerId: string, apiKey: string) => {
    const { secrets } = required();
    const secretKey = secretKeyFor(providerId);
    if (secretKey === undefined) throw new Error(`'${providerId}' does not take an API key`);
    if (apiKey.length === 0) await secrets.delete(secretKey);
    else await secrets.set(secretKey, apiKey);
  });

  // Only the line itself reaches a speech engine: never the screen or the conversation.
  ipcMain.handle(IPC.speak, (_event, text: string, preview?: SpeakPreview) =>
    required().voice.speak(String(text), preview),
  );

  // Talk to Scout started: note the window you are on, as the ask key does (never the
  // selection: copying it would press keys while the talk key is held), and start loading
  // the speech model while the person talks.
  ipcMain.handle(IPC.prepareListening, async () => {
    const current = required();
    await captureForPanel(current, ['activeWindow']).catch((error: unknown) =>
      console.warn('[main] could not note the window for a spoken question', error),
    );
    return current.listen.prepare();
  });

  // The recording, as 16 kHz samples. Turned into text here and dropped: never sent, never kept.
  ipcMain.handle(IPC.transcribe, (_event, samples: Float32Array) =>
    required().listen.transcribe(
      samples instanceof Float32Array ? samples : new Float32Array(samples),
    ),
  );

  ipcMain.handle(IPC.savePet, async (_event, pet: Pet): Promise<Pet> => {
    const saved = (await engine().client.call('pets.upsert', { pet })).pet;
    refreshStrip();
    return saved;
  });

  ipcMain.handle(IPC.deletePet, async (_event, petId: string): Promise<boolean> => {
    const { deleted } = await engine().client.call('pets.delete', { petId });
    refreshStrip();
    return deleted;
  });

  // A click on the crew strip opens the panel on that pet, the way the chat button does.
  ipcMain.handle(IPC.selectPet, (_event, petId: string) => {
    const current = required();
    // A click on the pet opens its bubble, or keeps the open one and gives it the keyboard
    // back (the click focused the pet's window). It never closes it.
    if (current.panel?.isVisible() !== true) openPanelNow(current);
    else if (current.avatar !== null) showPanelBeside(current.panel, current.avatar);
    current.panel?.webContents.send(IPC.activePetEvent, petId);
  });

  ipcMain.handle(IPC.resizeStrip, (_event, visiblePets: number) => {
    const avatar = required().avatar;
    if (avatar === null || avatar.isDestroyed()) return;
    const width = stripWidth(visiblePets);
    const [x, y] = avatar.getPosition();
    const area = screen.getDisplayMatching(avatar.getBounds()).workArea;
    const at = resolveAvatarPosition({ x: x ?? null, y: y ?? null }, area, width);
    avatar.setBounds({ x: at.x, y: at.y, width, height: AVATAR_SIZE });
  });

  ipcMain.handle(IPC.listModels, async (_event, providerId: string): Promise<ModelList> => {
    const current = required();
    // No engine, no list: the form still takes a typed model id.
    if (current.host === null) return { models: [], source: 'fallback' };
    return current.host.client.call('models.list', { providerId });
  });

  ipcMain.handle(IPC.openSettings, () => openSettingsPage());
  ipcMain.handle(IPC.openOnboarding, () => openOnboarding());
  ipcMain.handle(IPC.openOffice, () => openOffice());

  ipcMain.handle(IPC.findAgents, () => findAgents());
  ipcMain.handle(IPC.checkClaudeSignIn, () => checkClaudeSignIn());

  // Settings' "no sign-in found": the key is stored first, then Scout moves to that service.
  ipcMain.handle(IPC.switchScout, async (_event, providerId: string): Promise<Pet> => {
    const client = engine().client;
    const companion = getRole('companion');
    if (companion === undefined) throw new Error('The role library has no Companion.');
    const { pets } = await client.call('pets.list', {});
    const { defaultPetId } = required().settings;
    const current = pets.find((pet) => pet.id === defaultPetId);
    if (current === undefined) throw new Error(`There is no ${defaultPetId} to switch.`);
    const saved = (
      await client.call('pets.upsert', { pet: companionOn(current, providerId, companion) })
    ).pet;
    refreshStrip();
    return saved;
  });

  // Scout becomes the Companion on the chosen brain and docks alone; the others are hidden,
  // not deleted. Then Welcome closes and Scout says hello in its bubble, without taking focus.
  ipcMain.handle(IPC.finishWelcome, async (_event, providerId: string) => {
    const current = required();
    const client = engine().client;
    const companion = getRole('companion');
    if (companion === undefined) throw new Error('The role library has no Companion.');
    const { pets } = await client.call('pets.list', {});
    const { defaultPetId } = current.settings;
    const { scout, hiddenPets } = welcomeCrew(pets, defaultPetId, providerId, companion);
    await client.call('pets.upsert', { pet: scout });
    // Claude Code, when it is here, becomes the first expert, so a hand-off works at once.
    const { experts } = await client.call('experts.list', {});
    for (const expert of welcomeExperts(await findAgents(), experts)) {
      await client.call('experts.upsert', { expert });
    }
    const patch: SettingsPatch = { hiddenPets, welcome: { done: true } };
    current.settings = (await client.call('settings.set', { patch })).settings;
    refreshStrip();
    current.onboardingWindow?.close();
    if (current.panel !== null && current.avatar !== null) {
      current.avatar.show();
      current.panel.webContents.send(IPC.greetEvent);
      showPanelQuietly(current.panel, current.avatar);
    }
  });

  // The pet is dragged by hand (a drag region would swallow its clicks), and its bubble
  // moves with it, so it keeps speaking from the pet.
  ipcMain.handle(IPC.dragAvatar, (_event, dx: number, dy: number) => {
    const { panel, avatar } = required();
    if (avatar === null || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const bounds = avatar.getBounds();
    moveWindow(avatar, { ...bounds, x: Math.round(bounds.x + dx), y: Math.round(bounds.y + dy) });
    if (panel !== null && panel.isVisible()) placePanel(panel, avatar);
  });
  ipcMain.handle(IPC.dropAvatar, () => {
    const { host, avatar } = required();
    if (avatar === null || host === null) return;
    const [x, y] = avatar.getPosition();
    void host.client
      .call('settings.set', { patch: { avatar: { x: x ?? null, y: y ?? null } } })
      .catch((error: unknown) => console.warn('[main] could not persist avatar position', error));
  });

  ipcMain.handle(IPC.fitPanel, (_event, height: number) => {
    const { panel, avatar } = required();
    if (panel === null || avatar === null || !Number.isFinite(height)) return;
    fitPanel(panel, avatar, height);
  });

  ipcMain.handle(IPC.openLink, async (_event, url: string) => {
    if (!isAllowedLink(url)) throw new Error(`Tagalong only opens provider key pages, not ${url}`);
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC.showExtensionFolder, async () => {
    const folder = localExtensionFolder();
    if (folder === undefined) throw new Error('The Chrome extension has not been built here.');
    const problem = await shell.openPath(folder);
    if (problem.length > 0) throw new Error(problem);
  });
  ipcMain.handle(IPC.hidePanel, () => required().panel?.hide());
  // A remark's two buttons. Not now quiets Scout for an hour; taking the offer sends its
  // brief to the hand-off card, where nothing runs until the person presses Send.
  ipcMain.handle(IPC.remarkNotNow, async () => {
    await required().host?.client.call('keepAnEye.notNow', {});
  });
  ipcMain.handle(IPC.remarkAccept, async (_event, remarkId: string) => {
    await required().host?.client.call('keepAnEye.accept', { remarkId });
  });
  ipcMain.handle(IPC.togglePanel, () => {
    const current = required();
    if (current.panel?.isVisible() === true) {
      current.panel.hide();
    } else openPanelNow(current);
  });
}
