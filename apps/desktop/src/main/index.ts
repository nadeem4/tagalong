/**
 * The desktop app's main process: boots the engine, makes the windows (Scout, its bubble,
 * Home, Welcome, the pointer overlay), the tray and the hotkeys, and wires every IPC channel.
 * Handlers that need only the engine, settings or voice live in `ipc/`; the ones here need
 * Electron itself: they move windows, read the screen or open things through the shell.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  clipboard,
  dialog,
  ipcMain,
  powerMonitor,
  shell,
  utilityProcess,
} from 'electron';
import {
  ContextSnapshot,
  HandoffFinishedParams,
  PetRemarkParams,
  RoutineResultParams,
  SCOUT_ID,
} from '@tagalong/protocol';
import type {
  PerceptionTarget,
  PickUpReadyParams,
  Settings,
  SettingsPatch,
} from '@tagalong/protocol';
import { SettingsStore } from '@tagalong/core';
import {
  AlwaysListening,
  listeningPaused,
  saveListening,
  startListeningGuard,
} from './always-listening';
import { startWellbeingTick, watchPresence } from './presence';
import { systemClock } from './awareness/clock';
import { handoffLine, handoffNotice } from './handoff-notice';
import { StatusMarks, clearBrainMarks, markListening, setPanelMark } from './status-marks';
import {
  brainLine,
  brainReadiness,
  brainStatus,
  recordCleanClose,
  recordLaunch,
  SIGN_IN_BUDGET_MS,
} from './launch';
import type { PreviousLaunch } from './launch';
import { routineDelivery } from './routine-delivery';
import { nativeCodec } from './awareness/native-codec';
import { PerceptionMemory } from './awareness/perception-memory';
import { RollingMemory } from './awareness/rolling-memory';
import { captureNotice, captureTooltip } from './capture-notice';
import { captureAskSnapshot, capturePatch } from './context';
import { startEngineHost } from './engine-host';
import { keepAnEyeAllowed, startKeepAnEye } from './keep-an-eye';
import { isAllowedLink } from './links';
import {
  ELEVENLABS_SECRET_KEY,
  forgetRetiredKeys,
  providerChoices,
  storedKeys,
} from './provider-choices';
import { WHATS_NEW } from './whats-new';
import { elevenLabsTts } from './voice/elevenlabs';
import { kokoroDownloaded } from './voice/kokoro';
import { createVoiceService, elevenLabsMouth, localMouth } from './voice/voice';
import { VoiceWorker } from './voice/worker/client';
import type { WorkerProcess } from './voice/worker/messages';
import { WorkerLocalVoice } from './voice/worker/worker-local-voice';
import type { VoiceService } from './voice/voice';
import { openClaudeSignIn, signInFor } from './claude-sign-in';
import { findAgents, launchLine, shouldOpenWelcome } from './welcome';
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
import { moveWindow } from './windows/move';
import { createHomeWindow } from './windows/home';
import { createPointerOverlay } from './windows/pointer';
import { createWelcomeWindow } from './windows/welcome';
import { createSettingsWindow } from './windows/settings';
import { fromWindow, registerClipboardIpc } from './ipc/clipboard';
import { registerConnectionIpc } from './ipc/connections';
import { registerScoutIpc } from './ipc/scout';
import { registerExpertIpc } from './ipc/experts';
import type { EngineCall, IpcHandle } from './ipc/handle';
import { registerRoutineIpc } from './ipc/routines';
import { registerPickUpIpc } from './ipc/pick-up';
import { PickUpAllowlist, PickUpWaiting } from './pick-up-open';
import { registerSightLogIpc } from './ipc/sight-log';
import { registerMemoryIpc } from './ipc/memory';
import { registerSettingsIpc } from './ipc/settings';
import { registerTurnIpc } from './ipc/turns';
import { dropDesk, registerDropIpc } from './drop';
import { nodeDropFs } from './drop-io';
import { forwardEars, registerVoiceIpc } from './ipc/voice';
import { registerHealthIpc } from './ipc/health';
import { fixPage } from './fix-target';
import { IPC } from '../shared/ipc';
import type { CaptureNotice } from '../shared/ipc';

/** Everything the app owns once it is up. Assembled in `start`, torn down on quit. */
interface Desktop {
  /** Null when the engine refused to boot; `start` says why the app runs on without it. */
  host: EngineHost | null;
  bootError: string | null;
  platform: Platform;
  settingsStore: SettingsStore;
  /** What the last launch left behind: whether it crashed, and which version it ran. */
  previousLaunch: PreviousLaunch;
  /** The settings the running app is using; refreshed whenever they are saved. */
  settings: Settings;
  secrets: SafeStorageSecretStore;
  avatar: BrowserWindow | null;
  panel: BrowserWindow | null;
  tray: Tray;
  settingsWindow: BrowserWindow | null;
  /** The Welcome window, while it is open. */
  welcomeWindow: BrowserWindow | null;
  /** Scout is hidden until the first Welcome is done. */
  scoutWaits: boolean;
  /** Home, while it is open. */
  homeWindow: BrowserWindow | null;
  /** The snapshot the last hotkey captured, handed to the panel and sent with the ask. */
  pendingSnapshot: ContextSnapshot | null;
  /** Turn ids in flight: the panel must not vanish on focus loss mid-answer. */
  activeTurns: Set<string>;
  hotkeys: HotkeyManager;
  hotkeyError: string | null;
  /** Whether the user has sight turned off. Read by the platform gate on every read. */
  sightPause: SightPause;
  /** The last few minutes of the screen, in memory, opt-in. */
  rolling: RollingMemory;
  /** Answers perception.recall and perception.diff. */
  perceptionMemory: PerceptionMemory;
  /** Turns Scout's lines into audio for the panel to play. */
  voice: VoiceService;
  /** The process the voice models run in, Scout's voice and its ears; stopped on quit. */
  voiceWorker: VoiceWorker;
  /** Always listening: from the saved setting at launch, saved again on each switch. */
  listening: AlwaysListening;
  /** The status marks on Scout and in the bubble; the top one goes to every window. */
  statusMarks: StatusMarks;
}

let desktop: Desktop | null = null;

/** The item last dropped on Scout, held unread until a button on its card takes it. */
const drops = dropDesk(nodeDropFs);
/** The Claude sign-in check, started at boot so a cold `claude` has had time before the greeting. */
let signInCheck: ReturnType<typeof signInFor> | null = null;

// The fake ears need no real microphone: Chromium's fake device stands in for one, and
// the permission prompt answers itself. Switches only take effect before the app is ready.
if (process.env.TAGALONG_FAKE_STT === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

// A second launch focuses the pet that is already running.
//
// Two engines would fight over the same port and the same SQLite file, so the lock is
// taken before anything else happens.
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

/** Set once quit begins, so a closing window never starts anything new on the way out. */
let quitting = false;

app.on('before-quit', () => {
  quitting = true;
  desktop?.hotkeys.dispose();
  desktop?.voiceWorker.stop();
  stopKeepAnEye();
  stopListeningGuard();
  pointerOverlay?.dispose();
  stopPresence();
  stopWellbeing();
  // Memory only, and gone on quit: nothing here was ever written anywhere to clean up.
  desktop?.rolling.dispose();
  desktop?.perceptionMemory.clear();
  // The next launch's greeting counts the time away from now, not from when this one opened.
  recordCleanClose(desktop?.settingsStore, new Date());
  void desktop?.host?.shutdown();
});

async function start(): Promise<void> {
  signInCheck = signInFor(process.env);
  signInCheck.catch(() => undefined); // a failure here reads as unknown at greet time, never unhandled
  const sightPause = new SightPause();
  // Gated at the source, so every present and future reader is covered by construction.
  // Nothing downstream is handed the ungated adapter, which is what makes forgetting to
  // consult the pause impossible rather than merely discouraged.
  const platform = gateSight(createPlatform(), () => sightPause.paused);
  const dataDir = app.getPath('userData');
  const secrets = new SafeStorageSecretStore(dataDir);
  void forgetRetiredKeys(secrets).catch(() => {});
  const settingsStore = new SettingsStore(dataDir);

  // Before anything else reads or writes settings: what the last launch left, then this one.
  const previousLaunch = recordLaunch(settingsStore, app.getVersion());
  const settings = settingsStore.get();
  // From the saved setting, before any window opens, so the mark on Scout shows from the
  // first second listening is on.
  const listening = new AlwaysListening(settings.listening.always);
  const statusMarks = new StatusMarks((top) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.statusMarkEvent, top);
    }
  });
  // "Listening" on Scout for a few seconds: the mark, not a spoken line, says it is on.
  markListening(statusMarks, listening);

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
      showRing: (ring) => pointer().show(ring),
    });
  } catch (error) {
    // A missing API key is the ordinary first run, not a crash. Quitting here would leave
    // the user with no way to reach the settings window that fixes it.
    bootError = error instanceof Error ? error.message : String(error);
    console.error('[main] the engine did not start:', bootError);
  }

  // The voice models run in their own process; it starts when first needed: at launch if an earlier run downloaded Kokoro, otherwise on Scout's first line.
  const voiceWorker = new VoiceWorker(
    () =>
      utilityProcess.fork(fileURLToPath(new URL('./voice-worker.js', import.meta.url)), [], {
        serviceName: 'Tagalong voice',
        env: { ...process.env, TAGALONG_VOICE_DIR: join(dataDir, 'voice') },
      }) as unknown as WorkerProcess,
  );

  desktop = {
    host,
    bootError,
    platform,
    settingsStore,
    previousLaunch,
    settings,
    secrets,
    avatar: null,
    panel: null,
    tray: createTray(),
    settingsWindow: null,
    welcomeWindow: null,
    scoutWaits: false,
    homeWindow: null,
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
    voiceWorker,
    listening,
    statusMarks,
    voice: (() => {
      // The model downloads into the data dir on first use, never at start.
      const local = new WorkerLocalVoice(voiceWorker);
      return createVoiceService({
        env: process.env,
        settings: () => (desktop?.settings ?? settings).voice,
        local,
        mouths: {
          kokoro: localMouth(local),
          elevenlabs: elevenLabsMouth(
            () => secrets.get(ELEVENLABS_SECRET_KEY).catch(() => null),
            () => (desktop?.settings ?? settings).voice.elevenLabsVoiceId,
            (apiKey, voiceId) => elevenLabsTts(apiKey, voiceId),
          ),
        },
      });
    })(),
  };

  rolling.configure(settings.rollingMemory);
  // Kokoro loads now only when an earlier run downloaded it, so Scout's first lines are
  // Kokoro rather than the system voice. A first download still waits for the first line.
  desktop.voice.warmAtStart(kokoroDownloaded(join(dataDir, 'voice')));

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

  // Every window that shows Always listening follows this one state. Only `on` is saved.
  listening.onChange((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC.listeningEvent, state);
    }
  });
  listening.onChange(
    saveListening({
      saved: settings.listening.always,
      host: () => desktop?.host ?? null,
      settingsStore: () => settingsStore,
      onSaved: (saved) => {
        if (desktop !== null) desktop.settings = saved;
      },
    }),
  );
  // A call or a full-screen window in front pauses listening, as it does keeping an eye, and
  // so do the pets being hidden (none shown yet: the avatar is made below).
  pauseListening = (change) => {
    listeningWhy = { ...listeningWhy, ...change };
    listening.setPaused(listeningPaused(listeningWhy));
  };
  pauseListening({});
  stopListeningGuard = startListeningGuard({
    listening,
    list: async () => {
      const exclusions = desktop?.settings.captureExclusions ?? settings.captureExclusions;
      return (await platform.listWindows(exclusions, { countText: false })).windows;
    },
    onBlocked: (blocked) => pauseListening({ blocked }),
  });

  registerIpc();

  // What the ears hear goes to every open window: each listening window keeps only its own
  // session's words. Subscribing does not start the voice process; the first listen does.
  // Words addressed to Scout bring the bubble up if it is hidden, beside a visible pet, and
  // without the keyboard: the person may be typing in another app when they say "Scout".
  // Speaking a question needs no keyboard, and a click back elsewhere would hide the bubble.
  forwardEars(
    voiceWorker,
    (channel, payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(channel, payload);
      }
    },
    () => {
      const panel = desktop?.panel;
      const avatar = desktop?.avatar;
      if (panel != null && avatar != null && avatar.isVisible() && !panel.isVisible()) {
        showPanelQuietly(panel, avatar);
      }
    },
    // A reply in the follow-up window needs no name; the download and ears failures show on Scout.
    { followUp: () => listening.state.followUp, marks: statusMarks },
  );

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
  // Windows ends a session (shutdown, restart, sign-out) without before-quit; that is a
  // clean close too, not a crash.
  desktop.avatar.on('session-end', () => recordCleanClose(desktop?.settingsStore, new Date()));
  // The pets hidden (the tray's Hide pets, or Welcome first): listening waits for them.
  const avatar = desktop.avatar;
  avatar.on('show', () => pauseListening({ petsShown: true }));
  avatar.on('hide', () => pauseListening({ petsShown: false }));
  pauseListening({ petsShown: avatar.isVisible() });
  // Away from the keyboard or locked: Scout dozes. One number from the OS, nothing on screen.
  stopPresence = watchPresence(powerMonitor, (event) => {
    const pet = desktop?.avatar;
    if (pet != null && !pet.isDestroyed()) pet.webContents.send(IPC.turnEvent, event);
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
  if (welcoming) openWelcome();
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
  // Gentle nudges: the idle time and titles once a minute, only while on and sight is not paused.
  stopWellbeing = startWellbeingTick({
    enabled: () => (desktop?.settings.wellbeing.enabled ?? false) && !sightPause.paused,
    idleMs: () => powerMonitor.getSystemIdleTime() * 1000,
    list: async () => {
      const exclusions = desktop?.settings.captureExclusions ?? settings.captureExclusions;
      return (await platform.listWindows(exclusions, { countText: false })).windows;
    },
    send: (params) => host.client.call('wellbeing.observe', params),
  });
}

/** Stops the gentle nudges' tick on quit. */
let stopWellbeing = (): void => undefined;

/** Stops the keep-an-eye timer on quit. */
let stopKeepAnEye = (): void => undefined;
/** Stops the Always-listening guard on quit. */
let stopListeningGuard = (): void => undefined;
/** Stops reading the idle time on quit. */
let stopPresence = (): void => undefined;
/** Why Always listening waits: a call or full screen in front, the pets hidden, or Welcome open. */
let listeningWhy = { blocked: false, petsShown: false, setupOpen: false };
let pauseListening: (change: Partial<typeof listeningWhy>) => void = () => undefined;

/** The projects the pick-up last shown named: the only ones its Open may reach. */
const pickUpAllowlist = new PickUpAllowlist();
/** A pick-up waiting for the open bubble to hide: one at most, the latest. */
const pickUpWaiting = new PickUpWaiting();

/**
 * Back after a long break, found on a tick rather than at launch (Always listening's line went
 * first, or the PC slept), or one the launch line could not carry (the Fix it line): the
 * pick-up line beside Scout, like a remark. With the bubble open, it waits until the bubble
 * next hides, and is dropped if pick-up was switched off meanwhile.
 */
function showPickUp(params: unknown): void {
  const pickUp = params as PickUpReadyParams;
  const panel = desktop?.panel;
  const avatar = desktop?.avatar;
  if (panel == null || avatar == null || !avatar.isVisible()) return;
  if (panel.isVisible()) {
    if (pickUpWaiting.hold(pickUp)) {
      panel.once('hide', () => {
        const next = pickUpWaiting.release();
        if (next !== null && desktop?.settings.pickUp !== false) showPickUp(next);
      });
    }
    return;
  }
  pickUpAllowlist.set(pickUp);
  panel.webContents.send(IPC.greetLineEvent, { text: pickUp.text, pickUp });
  showPanelQuietly(panel, avatar);
}

/**
 * A line about a finished hand-off lands on its card while the bubble is open; with the
 * bubble closed it loses its hand-off id and comes as an ordinary line, so it is not lost.
 */
function routeHandoffLine(notification: { method: string; params: unknown }): {
  method: string;
  params: unknown;
} {
  if (notification.method !== 'pet.remark') return notification;
  const parsed = PetRemarkParams.safeParse(notification.params);
  if (!parsed.success) return notification;
  const bubbleOpen = desktop?.panel?.isVisible() === true;
  return { method: notification.method, params: handoffLine(parsed.data, bubbleOpen) };
}

/**
 * Scout has one thing to say from a check-in: one quiet line beside the pet, without taking
 * the keyboard. Not while the bubble is already open: the person is busy with it, and a
 * remark is never worth interrupting them for. A line still tied to a finished hand-off
 * (the bubble is open) goes to its card there instead, through the forward.
 */
function showRemark(params: unknown): void {
  const panel = desktop?.panel;
  const avatar = desktop?.avatar;
  if ((params as { handoffId?: unknown } | null)?.handoffId !== undefined) return;
  if (panel == null || avatar == null || !avatar.isVisible() || panel.isVisible()) return;
  panel.webContents.send(IPC.remarkEvent, params);
  showPanelQuietly(panel, avatar);
  // The panel says the remark aloud like any bubble line: shortened, one at a time, and
  // silent when Scout talks is off. Speech lives in the panel, which owns the queue and stop.
}

/**
 * A later launch: Scout says one line beside itself without taking the keyboard, and the
 * launch is remembered (the quit is too, in before-quit) so the next one knows how long you
 * were away and which hand-offs finished since. The line reads no screen. It waits for the
 * composed line and for the sign-in check (at most SIGN_IN_BUDGET_MS), both in parallel; the
 * engine falls back to a handwritten line, so no brain is ever waited on past that.
 */
async function greetOnLaunch(host: EngineHost): Promise<void> {
  const current = desktop;
  if (current === null) return;
  // The engine hands a pick-up out once, so one the line did not carry is shown after it.
  let offered: PickUpReadyParams | undefined;
  let carried = false;
  try {
    const line = await launchLine(current.settings, async () => {
      const { previousLaunch } = current;
      // Compose first, then check the brain beside it, so a slow check never delays the line.
      const composing = host.client.call('greeting.compose', {
        petId: SCOUT_ID,
        launch: { ...previousLaunch, version: app.getVersion(), whatsNew: WHATS_NEW },
      });
      const readiness = (async () => {
        const { pets } = await host.client.call('pets.list', {});
        return brainReadiness({
          pet: pets.find((pet) => pet.id === SCOUT_ID),
          providers: providerChoices(await storedKeys(current.secrets)),
          signIn: () => signInCheck ?? signInFor(process.env),
          budgetMs: SIGN_IN_BUDGET_MS,
        });
      })().catch(() => 'unknown' as const);
      const [brain, composed] = await Promise.all([readiness, composing]);
      offered = composed.pickUp;
      // Why Scout cannot think shows on Scout as a mark until it can again.
      const status = brainStatus(brain);
      if (status !== null) current.statusMarks.set({ id: status });
      return brainLine(brain, composed.text, composed.pickUp);
    });
    if (line !== null) {
      const { panel, avatar } = current;
      if (panel !== null && avatar !== null && avatar.isVisible() && !panel.isVisible()) {
        if (panel.webContents.isLoading()) {
          await new Promise<void>((resolve) => panel.webContents.once('did-finish-load', resolve));
        }
        const pickUp = 'pickUp' in line ? line.pickUp : undefined;
        if (pickUp !== undefined) pickUpAllowlist.set(pickUp);
        panel.webContents.send(IPC.greetLineEvent, line);
        showPanelQuietly(panel, avatar);
        carried = pickUp !== undefined;
      }
    }
  } catch (error) {
    console.warn('[main] the greeting did not run:', error);
  }
  // The Fix it line won, or the bubble was open: the pick-up follows once the bubble hides.
  if (offered !== undefined && !carried) showPickUp(offered);
  try {
    const patch: SettingsPatch = { lastOpenedAt: new Date().toISOString() };
    current.settings = (await host.client.call('settings.set', { patch })).settings;
  } catch (error) {
    console.warn('[main] could not remember this launch:', error);
  }
}

/**
 * Binds the four hotkeys (ask, pause sight, stop voice, talk) to what settings say, and
 * reports what was refused.
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
 * microphone only ever opens in the panel, on this key or its mic button. While Welcome is
 * open the key brings Welcome forward instead: Welcome may be listening, and one mic is enough.
 */
function talkPressed(): void {
  if (desktop === null) return;
  if (desktop.welcomeWindow !== null && !desktop.welcomeWindow.isDestroyed()) {
    desktop.welcomeWindow.focus();
    return;
  }
  if (desktop.panel === null || desktop.avatar === null) return;
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

/** Reloads Scout's window after Scout's record changed. */
function reloadAvatar(): void {
  const avatar = desktop?.avatar;
  if (avatar !== null && avatar !== undefined && !avatar.isDestroyed()) avatar.webContents.reload();
}

/** Point, don't click: the ring overlay, made the first time Scout points. */
let pointerOverlay: ReturnType<typeof createPointerOverlay> | null = null;
function pointer(): ReturnType<typeof createPointerOverlay> {
  pointerOverlay ??= createPointerOverlay();
  return pointerOverlay;
}

/** A finished turn that said something. */
function hasText(params: { text?: unknown }): boolean {
  return typeof params.text === 'string' && params.text !== '';
}

/** Turn notifications drive the UI, and main is the only thing holding the socket. */
function forwardToRenderers(incoming: { method: string; params: unknown }): void {
  const notification = routeHandoffLine(incoming);
  const params = (notification.params ?? {}) as { turnId?: string; text?: unknown };
  if (notification.method === 'turn.started' && params.turnId !== undefined) {
    desktop?.activeTurns.add(params.turnId);
    // The next message puts the last ring away.
    pointerOverlay?.hide();
  }
  if (
    (notification.method === 'turn.completed' || notification.method === 'turn.error') &&
    params.turnId !== undefined
  ) {
    desktop?.activeTurns.delete(params.turnId);
  }
  // An answer with words means Scout can think: the brain mark goes.
  if (notification.method === 'turn.completed' && desktop !== null && hasText(params)) {
    clearBrainMarks(desktop.statusMarks);
  }

  if (notification.method === 'watch.fired') announceWatch(notification.params);
  if (notification.method === 'handoff.finished') announceHandoff(notification.params);
  if (notification.method === 'pet.remark') showRemark(notification.params);
  if (notification.method === 'pickUp.ready') showPickUp(notification.params);
  // A brief to check: the bubble comes up beside the pet with the card in it.
  if (notification.method === 'handoff.proposed') bringUpBubble(true);
  // A change Scout wants to make in a connected app: the confirm card must be seen.
  if (notification.method === 'connector.confirm') bringUpBubble(true);
  // A routine Scout wrote: the card waits in the bubble for Save.
  if (notification.method === 'routine.proposed') bringUpBubble(true);
  // Settings Scout would change: the card waits in the bubble for Apply.
  if (notification.method === 'settings.proposed') bringUpBubble(true);
  if (notification.method === 'routine.result') deliverRoutine(notification.params);

  // The renderer speaks the UI package's TurnEvent shape: the wire params plus the
  // method as a discriminant.
  const event = { type: notification.method, ...params };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.turnEvent, event);
  }
}

/**
 * A watch fired: say so where the user will see it. The panel gets it as a card through the
 * ordinary event forward; this adds a system toast and brings the panel up beside the avatar.
 * The toast carries the judge's reason, or the condition when it gave none; the panel says a
 * reason aloud when Scout talks is on, and nothing without one.
 */
function announceWatch(params: unknown): void {
  const { message, condition } = (params ?? {}) as { message?: string; condition?: string };
  const body = message || condition;
  if (body !== undefined && body !== '' && Notification.isSupported()) {
    new Notification({ title: 'Tagalong — a watch fired', body, silent: false }).show();
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
  // The notice names the expert as Home does; its id stands in when the list cannot be read.
  void (async () => {
    const experts = await desktop?.host?.client
      .call('experts.list', {})
      .then((result) => result.experts)
      .catch(() => undefined);
    const name = experts?.find((expert) => expert.id === parsed.data.expertId)?.name;
    const notice = handoffNotice(parsed.data, name);
    if (notice !== null && Notification.isSupported()) {
      new Notification({ ...notice, silent: false }).show();
    }
  })();
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
        openHome: () => openHome(),
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
function openHome(page?: string): void {
  if (desktop === null) return;
  const open = desktop.homeWindow;
  if (open !== null && !open.isDestroyed()) {
    if (page !== undefined) open.webContents.send(IPC.homePageEvent, page);
    open.focus();
    return;
  }
  const window = createHomeWindow();
  window.on('closed', () => {
    if (desktop !== null) desktop.homeWindow = null;
  });
  if (page !== undefined) {
    window.webContents.once('did-finish-load', () =>
      window.webContents.send(IPC.homePageEvent, page),
    );
  }
  desktop.homeWindow = window;
}

/**
 * Settings is a page of Home. The standalone Settings window only opens when the engine
 * failed to start, since Home cannot work without it.
 */
function openSettingsPage(target?: unknown): void {
  const page = fixPage(target);
  if (desktop?.host === null) openSettings();
  else openHome(page);
}

/** Opens Welcome, or brings the open one forward. */
function openWelcome(): void {
  if (desktop === null) return;
  if (desktop.welcomeWindow !== null && !desktop.welcomeWindow.isDestroyed()) {
    desktop.welcomeWindow.focus();
    return;
  }
  const window = createWelcomeWindow();
  // Always listening waits while Welcome is open, so the two never share the voice process.
  pauseListening({ setupOpen: true });
  window.on('closed', () => {
    pauseListening({ setupOpen: false });
    if (desktop === null) return;
    desktop.welcomeWindow = null;
    // Closed without Start, Scout still arrives: an install never ends with nothing on screen.
    // Only the first Welcome hides it, so this never undoes the tray's Hide Scout. Not while
    // quitting: the close is the app going away, and showing a window then can stall the exit.
    if (desktop.scoutWaits && !quitting) desktop.avatar?.show();
    desktop.scoutWaits = false;
  });
  desktop.welcomeWindow = window;
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

/**
 * Wires every IPC channel. The handlers that only need the engine, the settings or the
 * voice live in `ipc/`, which takes what it needs as arguments so it is tested without
 * Electron; the ones left here need Electron itself: they move windows, read the screen
 * or open things through the shell.
 */
function registerIpc(): void {
  const required = (): Desktop => {
    if (desktop === null) throw new Error('the desktop host is not ready yet');
    return desktop;
  };

  /** Anything that needs a turn to run needs the engine that runs it. */
  const engine = (): EngineCall => {
    const current = required();
    if (current.host === null) {
      throw new Error(current.bootError ?? 'the engine is not running');
    }
    return current.host.client;
  };

  const handle: IpcHandle = (channel, listener) =>
    ipcMain.handle(channel, listener as (event: unknown, ...args: unknown[]) => unknown);

  registerTurnIpc(handle, {
    engine,
    maybeEngine: () => required().host?.client ?? null,
    pendingSnapshot: () => required().pendingSnapshot,
    takeDrop: () => drops.take(),
  });
  registerScoutIpc(handle, {
    engine,
    settings: () => required().settings,
    setSettings: (settings) => {
      required().settings = settings;
    },
    reloadAvatar,
    findAgents: () => findAgents(),
    welcomed: () => {
      const current = required();
      current.welcomeWindow?.close();
      if (current.panel !== null && current.avatar !== null) {
        current.avatar.show();
        current.panel.webContents.send(IPC.greetEvent);
        showPanelQuietly(current.panel, current.avatar);
      }
    },
  });
  registerExpertIpc(handle, { engine });
  registerConnectionIpc(handle, { engine });
  registerPickUpIpc(handle, {
    engine,
    allowlist: pickUpAllowlist,
    openExternal: (url) => shell.openExternal(url),
    openPath: (folder) => shell.openPath(folder),
  });
  registerSightLogIpc(handle, { engine });
  registerMemoryIpc(handle, { engine });
  registerRoutineIpc(handle, {
    engine,
    openHome: (page) => openHome(page),
    homeWindow: () => required().homeWindow,
  });
  registerSettingsIpc(handle, {
    host: () => required().host,
    settingsStore: () => required().settingsStore,
    secrets: () => required().secrets,
    problem: () => {
      const current = required();
      return current.hotkeyError ?? current.bootError;
    },
    version: () => app.getVersion(),
    setSettings: (settings) => {
      required().settings = settings;
    },
    applyHotkeys: (settings) => {
      applyHotkeys(settings);
    },
    configureRolling: (rollingMemory) => required().rolling.configure(rollingMemory),
    broadcast: (settings) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.settingsChangedEvent, settings);
      }
    },
    listeningOff: () => {
      required().listening.set(false);
    },
    fromPanel: fromWindow(() => required().panel),
  });
  registerVoiceIpc(handle, {
    voice: () => required().voice,
    // The voice process starts on the first listen, if Scout has not spoken yet.
    worker: () => required().voiceWorker,
    noteActiveWindow: () => captureForPanel(required(), ['activeWindow']),
    listening: () => required().listening,
    on: (channel, listener) => ipcMain.on(channel, listener as never),
    voiceDir: () => join(app.getPath('userData'), 'voice'),
  });
  registerClipboardIpc(handle, {
    writeText: (text) => clipboard.writeText(text),
    fromPanel: fromWindow(() => required().panel),
  });
  registerHealthIpc(handle, { engine });

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

  ipcMain.handle(IPC.getContext, () => required().pendingSnapshot);
  // A window that opened after the last toggle has missed the event, and an avatar that
  // shows sight running while it is paused is the one lie this feature cannot afford.
  ipcMain.handle(IPC.getSightPaused, () => required().sightPause.paused);
  ipcMain.handle(IPC.getRecording, () => required().rolling.recording);
  ipcMain.handle(IPC.getStatusMark, () => required().statusMarks.top());
  // Only the panel's own marks (the mic failing, Say “Scout”); setPanelMark refuses the rest.
  ipcMain.handle(IPC.setStatusMark, (_event, id: unknown, on: unknown) =>
    setPanelMark(required().statusMarks, id, on),
  );
  ipcMain.handle(IPC.toggleSightPause, () => {
    required();
    return toggleSightPause();
  });

  ipcMain.handle(IPC.capture, async (_event, targets: PerceptionTarget[]) =>
    captureForPanel(required(), targets),
  );

  ipcMain.handle(IPC.openBubble, () => {
    const current = required();
    // A click on the pet opens its bubble, or keeps the open one and gives it the keyboard
    // back (the click focused the pet's window). It never closes it.
    if (current.panel?.isVisible() !== true) openPanelNow(current);
    else if (current.avatar !== null) showPanelBeside(current.panel, current.avatar);
  });

  // A Fix it names its target; fixPage refuses anything off the list.
  ipcMain.handle(IPC.openSettings, (_event, target: unknown) => openSettingsPage(target));
  ipcMain.handle(IPC.openWelcome, () => openWelcome());
  ipcMain.handle(IPC.openHome, () => openHome());

  // Check again in Settings: signed in now clears the brain mark on Scout.
  ipcMain.handle(IPC.checkClaudeSignIn, async () => {
    const state = await signInFor(process.env);
    if (state === 'signed-in' && desktop !== null) clearBrainMarks(desktop.statusMarks);
    return state;
  });
  ipcMain.handle(IPC.openClaudeSignIn, () => openClaudeSignIn());

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

  // Drop it on Scout: name the item, open the bubble on its card. Nothing is read yet.
  registerDropIpc(handle, {
    desk: drops,
    fromAvatar: fromWindow(() => required().avatar),
    show: (offer) => {
      const current = required();
      openPanelNow(current);
      current.panel?.webContents.send(IPC.dropEvent, offer);
    },
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

  ipcMain.handle(IPC.hidePanel, () => required().panel?.hide());
  ipcMain.handle(IPC.togglePanel, () => {
    const current = required();
    if (current.panel?.isVisible() === true) {
      current.panel.hide();
    } else openPanelNow(current);
  });
}
