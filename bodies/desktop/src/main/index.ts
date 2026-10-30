/**
 * The desktop app's main process: dials the brain, makes the windows (Scout, its bubble,
 * Home), the tray and the hotkeys, and wires every IPC channel.
 * Handlers that need only the brain, settings or voice live in `ipc/`; the ones here need
 * Electron itself: they move windows, read the screen or open things through the shell.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BrowserWindow,
  Menu,
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
  SCOUT_ID,
  TALK_KEY_LABELS,
  TALK_KEY_RIGHT_CTRL,
} from '@tagalong/protocol';
import type { PerceptionTarget, Settings } from '@tagalong/protocol';
import { SettingsStore } from './settings-store';
import {
  AlwaysListening,
  listeningPaused,
  saveListening,
  startListeningGuard,
} from './always-listening';
import { watchPresence } from './presence';
import { systemClock } from './awareness/clock';
import { installLogFile, openLogsFolder, rendererConsole } from './log-file';
import {
  StatusMarks,
  markBrainLink,
  markListening,
  setPanelMark,
} from './status-marks';
import { nativeCodec } from './awareness/native-codec';
import { PerceptionMemory } from './awareness/perception-memory';
import { RollingMemory } from './awareness/rolling-memory';
import { captureNotice, captureTooltip } from './capture-notice';
import { captureAskSnapshot, capturePatch } from './context';
import type { TurnEvent } from '@tagalong/ui';
import { createTurnEvents } from './brain/turn-events';
import { startBrain } from './brain/start';
import { elevenLabsTts } from './voice/elevenlabs';
import { kokoroDownloaded } from './voice/kokoro';
import { createVoiceService, elevenLabsMouth, localMouth } from './voice/voice';
import { VoiceWorker } from './voice/worker/client';
import type { WorkerProcess } from './voice/worker/messages';
import { WorkerLocalVoice } from './voice/worker/worker-local-voice';
import type { VoiceService } from './voice/voice';
import { saveAvatarSpot } from './avatar-spot';
import { offlineWatch } from './brain/offline-watch';
import { createBackSender, frontWindow, startFocusWatch } from './brain/body-events';
import type { BrainStatus } from '@tagalong/contract';
import type { BrainClient } from '@tagalong/contract';
import {
  DEFAULT_PAUSE_SIGHT_HOTKEY,
  DEFAULT_STOP_VOICE_HOTKEY,
  HotkeyManager,
  describeHotkeyProblems,
} from './hotkeys';
import type { HotkeyOutcome } from './hotkeys';
import { TalkKeyWatch, loadKeyHook, startTalkKey } from './talk-key';
import { createPlatform } from './platform/index';
import { gateSight } from './platform/sight-gate';
import { SightPause } from './sight-pause';
import type { Platform } from './platform/index';
import { ELEVENLABS_SECRET_KEY, SafeStorageSecretStore } from './secret-store';
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
import { fromWindow, registerClipboardIpc } from './ipc/clipboard';
import { forwardAppsChanged, registerConnectionIpc } from './ipc/connections';
import { registerScoutIpc } from './ipc/scout';
import type { IpcHandle } from './ipc/handle';
import { registerMemoryIpc } from './ipc/memory';
import { registerApprovalsIpc } from './ipc/approvals';
import { registerJobsIpc } from './ipc/jobs';
import { registerBrainLinkIpc } from './ipc/brain-link';
import { registerPermissionsIpc } from './ipc/permissions';
import { registerSettingsIpc } from './ipc/settings';
import { registerSpendIpc } from './ipc/spend';
import { registerTurnIpc } from './ipc/turns';
import { dropDesk, registerDropIpc } from './drop';
import { nodeDropFs } from './drop-io';
import { forwardEars, registerVoiceIpc } from './ipc/voice';
import { registerBrowserIpc } from './ipc/browser';
import { fixPage } from './fix-target';
import { IPC } from '../shared/ipc';
import type { CaptureNotice } from '../shared/ipc';

/** Everything the app owns once it is up. Assembled in `start`, torn down on quit. */
interface Desktop {
  /** The connection to the brain; always there, offline until the brain answers. */
  brain: BrainClient;
  platform: Platform;
  settingsStore: SettingsStore;
  /** The settings the running app is using; refreshed whenever they are saved. */
  settings: Settings;
  secrets: SafeStorageSecretStore;
  avatar: BrowserWindow | null;
  panel: BrowserWindow | null;
  tray: Tray;
  /** Home, while it is open. */
  homeWindow: BrowserWindow | null;
  /** The snapshot the last hotkey captured, handed to the panel and sent with the ask. */
  pendingSnapshot: ContextSnapshot | null;
  /** Turn ids in flight: the panel must not vanish on focus loss mid-answer. */
  activeTurns: Set<string>;
  hotkeys: HotkeyManager;
  hotkeyError: string | null;
  /** The talk key, watched through the key hook: press, release and cancel. */
  talkKey: TalkKeyWatch;
  /** Why the key hook could not start, or null while it watches the talk key. */
  talkKeyError: string | null;
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
/** The brain link as last reported, for the ask handler's choice of words. */
let brainStatus: BrainStatus = 'connecting';
/** Makes a wake turn the person spoke into visible; start() points it at the turn mapper. */
let claimTurn: (turnId: string) => void = () => undefined;

/** Scout's spot goes to the settings file and the live settings: the brain has no settings. */
function rememberAvatarSpot(position: { x: number | null; y: number | null }): void {
  if (desktop === null) return;
  saveAvatarSpot(desktop.settingsStore, position, (saved) => {
    if (desktop !== null) desktop.settings = saved;
  });
}

/** The item last dropped on Scout, held unread until a button on its card takes it. */
const drops = dropDesk(nodeDropFs);

// The fake ears need no real microphone: Chromium's fake device stands in for one, and
// the permission prompt answers itself. Switches only take effect before the app is ready.
if (process.env.TAGALONG_FAKE_STT === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

// A second launch focuses the pet that is already running.
//
// Two copies would fight over the same settings file and hotkeys, so the lock is taken
// before anything else happens.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Warnings and errors also go to %APPDATA%\Tagalong\logs\tagalong.log (log-file.ts).
  installLogFile({ dir: logsDir() });
  // Every window's warnings and errors join main's in the log file.
  app.on('web-contents-created', (_event, contents) =>
    contents.on('console-message', (details) => rendererConsole(details)),
  );
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

/** Where the log file lives: <userData>/logs, so %APPDATA%\Tagalong\logs on Windows. */
function logsDir(): string {
  return join(app.getPath('userData'), 'logs');
}

// The pets live in the tray, so closing a window is never a reason to quit.
app.on('window-all-closed', () => {});

/** Stops the key hook that watches the talk key; nothing until it has started. */
let stopTalkKey: () => void = () => {};

app.on('before-quit', () => {
  desktop?.hotkeys.dispose();
  stopTalkKey();
  desktop?.voiceWorker.stop();
  stopListeningGuard();
  stopPresence();
  stopFocusWatch();
  // Memory only, and gone on quit: nothing here was ever written anywhere to clean up.
  desktop?.rolling.dispose();
  desktop?.perceptionMemory.clear();
  desktop?.brain.stop();
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

  // The brain is a separate process the user runs; this only dials it and retries.
  const turnEvents = createTurnEvents(
    () => SCOUT_ID,
    () => brain.session,
  );
  const forwardTurn = (event: TurnEvent): void => {
    const { type, ...params } = event;
    forwardToRenderers({ method: type, params });
  };
  claimTurn = (turnId) => turnEvents.claim(turnId).forEach(forwardTurn);
  // A brain that stays down fails the open turns, so the bubble does not stream forever.
  const watchOffline = offlineWatch(() => turnEvents.resync().forEach(forwardTurn));
  const brain = startBrain({
    platform,
    exclusions: () => desktop?.settings.captureExclusions ?? settings.captureExclusions,
    onCapture: announceCapture,
    openExternal: (url) => shell.openExternal(url),
    onNotification: (method, params) => {
      // The brain changed something Home shows (memory, permissions): every window may refetch.
      if (method === 'changed') {
        const { what } = params as { what: string };
        forwardAppsChanged(what, forwardToRenderers);
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(IPC.brainChangedEvent, what);
        }
      }
      // Scout approved an ask under a preference: every window may tell the person once.
      if (method === 'approved') {
        // The report card shows on the panel: bring it up quietly, without the keyboard, and
        // say so, so the card hides it again (it never gets focus, so it never blurs).
        const cameUp = bringUpBubble(false);
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC.approvedEvent, { ...(params as object), cameUp });
          }
        }
      }
      turnEvents.map(method, params).forEach(forwardTurn);
    },
    onResync: () => turnEvents.resync().forEach(forwardTurn),
    onStatus: (status) => {
      brainStatus = status;
      markBrainLink(statusMarks, status);
      watchOffline(status);
      // Home's "Where things run" shows the link; it reads it again when it changes.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC.brainChangedEvent, 'link');
      }
    },
  });

  // The voice models run in their own process; it starts when first needed: at launch if an earlier run downloaded Kokoro, otherwise on Scout's first line.
  const voiceWorker = new VoiceWorker(
    () =>
      utilityProcess.fork(fileURLToPath(new URL('./voice-worker.js', import.meta.url)), [], {
        serviceName: 'Tagalong voice',
        env: { ...process.env, TAGALONG_VOICE_DIR: join(dataDir, 'voice') },
      }) as unknown as WorkerProcess,
  );

  desktop = {
    brain,
    platform,
    settingsStore,
    settings,
    secrets,
    avatar: null,
    panel: null,
    tray: createTray(),
    homeWindow: null,
    pendingSnapshot: null,
    activeTurns: new Set(),
    hotkeys: new HotkeyManager({
      onAsk: () => void openPanelWithContext(),
      onPauseSight: () => toggleSightPause(),
      onStopVoice: () => stopVoice(),
    }),
    hotkeyError: null,
    talkKey: new TalkKeyWatch({
      onPress: () => talkPressed(),
      onRelease: () => toPanel(IPC.talkReleaseEvent),
      onCancel: () => toPanel(IPC.talkCancelEvent),
    }),
    talkKeyError: null,
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

  desktop.panel = createPanelWindow({
    isStreaming: () => (desktop?.activeTurns.size ?? 0) > 0,
    pet: () => desktop?.avatar ?? null,
  });
  desktop.avatar = createAvatarWindow({
    position: settings.avatar,
    onMoved: (position) => rememberAvatarSpot(position),
  });
  // The pets hidden (the tray's Hide pets): listening waits for them.
  const avatar = desktop.avatar;
  avatar.on('show', () => pauseListening({ petsShown: true }));
  avatar.on('hide', () => pauseListening({ petsShown: false }));
  pauseListening({ petsShown: avatar.isVisible() });
  // Away from the keyboard or locked: Scout dozes. One number from the OS, nothing on screen.
  // The brain hears of a return after the same 5-minute idle, and of the front window changing.
  const sendToBrain = (name: string, data: unknown): boolean =>
    desktop?.brain.event(name, data) ?? false;
  const sendBack = createBackSender({
    send: sendToBrain,
    now: Date.now,
    idleMs: () => powerMonitor.getSystemIdleTime() * 1000,
  });
  stopPresence = watchPresence(powerMonitor, (event) => {
    const pet = desktop?.avatar;
    if (pet != null && !pet.isDestroyed()) pet.webContents.send(IPC.turnEvent, event);
    sendBack(event.type === 'presence.away' ? 'away' : 'back');
  });
  stopFocusWatch = startFocusWatch({
    // The platform is already gated by the sight pause; enabled also skips the listing.
    front: async () => {
      const exclusions = desktop?.settings.captureExclusions ?? settings.captureExclusions;
      return frontWindow((await platform.listWindows(exclusions, { countText: false })).windows);
    },
    send: sendToBrain,
    enabled: () => !sightPause.paused,
  });

  // Deliberately not a modal, and deliberately not fatal. The only way to store an
  // accelerator that cannot be registered is to type it into Settings, so refusing to
  // start because of it leaves the user locked out of the one window that could fix it,
  // with the settings file as the only way back. The manager binds each key
  // independently, so the others are already live; the failure is surfaced in the panel
  // and in Settings, where there is something to do about it.
  const talkKey = await startTalkKey(loadKeyHook, desktop.talkKey);
  stopTalkKey = talkKey.stop;
  desktop.talkKeyError = talkKey.error;
  applyHotkeys(settings);
}

/** Stops the Always-listening guard on quit. */
let stopListeningGuard = (): void => undefined;
/** Stops reading the idle time on quit. */
let stopPresence = (): void => undefined;
/** Stops reporting the front window to the brain on quit. */
let stopFocusWatch = (): void => undefined;
/** Why Always listening waits: a call or full screen in front, or the pets hidden. */
let listeningWhy = { blocked: false, petsShown: false };
let pauseListening: (change: Partial<typeof listeningWhy>) => void = () => undefined;

/**
 * Scout has one thing to say from a check-in: one quiet line beside the pet, without taking
 * the keyboard. While the panel is already open the bubble shows the words itself, as
 * Scout's message (the forward reaches it), and the quiet line stays out of the way. If the
 * panel is open on something else (a quiet line, a drop card) the bubble is not showing, so
 * the words are dropped.
 */
function showRemark(params: unknown): void {
  const panel = desktop?.panel;
  const avatar = desktop?.avatar;
  if (panel == null || avatar == null || !avatar.isVisible() || panel.isVisible()) return;
  // Right after launch the panel may still be loading: a line sent now would be lost.
  if (panel.webContents.isLoading()) {
    panel.webContents.once('did-finish-load', () => showRemark(params));
    return;
  }
  panel.webContents.send(IPC.remarkEvent, params);
  showPanelQuietly(panel, avatar);
  // The panel says the remark aloud like any bubble line: shortened, one at a time, and
  // silent when Scout talks is off. Speech lives in the panel, which owns the queue and stop.
}

/**
 * Binds the three hotkeys (ask, pause sight, stop voice) to what settings say, points the
 * key hook at the talk key, and reports what was refused, the talk key included.
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
  });
  const talk = settings.hotkeys.talk ?? TALK_KEY_RIGHT_CTRL;
  desktop.talkKey.setKey(talk);
  const talkOutcome: HotkeyOutcome =
    desktop.talkKeyError === null
      ? { accelerator: TALK_KEY_LABELS[talk], action: 'talk', registered: true }
      : {
          accelerator: TALK_KEY_LABELS[talk],
          action: 'talk',
          registered: false,
          error: desktop.talkKeyError,
        };

  desktop.hotkeyError = describeHotkeyProblems([...outcomes, talkOutcome]);
  if (desktop.hotkeyError !== null) console.error(`[main] ${desktop.hotkeyError}`);

  // Broadcast rather than wait for the next getHostView. The panel may already be open,
  // and a window still showing a problem the user has just fixed is the same kind of lie
  // as never showing it at all.
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.hotkeyProblemEvent, desktop.hotkeyError);
  }
  return desktop.hotkeyError;
}

/** Sends one talk event to the panel, if it is there. */
function toPanel(channel: string): void {
  const panel = desktop?.panel;
  if (panel != null && !panel.isDestroyed()) panel.webContents.send(channel);
}

/**
 * The talk key went down and stayed down alone for a moment (TALK_CONFIRM_MS), so a quick
 * shortcut never gets here. The bubble comes up without taking the keyboard: the release comes
 * from the key hook, not the bubble, and a bubble that took the focus would swallow the
 * shortcut the person meant if the press turns out to be Right Ctrl+C. The microphone only
 * ever opens in the panel, on this key or its mic button.
 */
function talkPressed(): void {
  if (desktop === null) return;
  if (desktop.panel === null || desktop.avatar === null) return;
  const { panel, avatar } = desktop;
  if (!panel.isVisible()) {
    avatar.show();
    showPanelQuietly(panel, avatar);
  }
  panel.webContents.send(IPC.talkEvent, Date.now());
}

/** The stop key: every window that is speaking stops at once and drops what it had queued. */
function stopVoice(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC.stopVoiceEvent);
  }
}

/** Turn notifications drive the UI, and main is the only thing holding the socket. */
function forwardToRenderers(incoming: { method: string; params: unknown }): void {
  // Read before showRemark below, which shows the hidden panel for the quiet line.
  const panelWasVisible = desktop?.panel?.isVisible() === true;
  const notification = incoming;
  const params = (notification.params ?? {}) as {
    turnId?: string;
    text?: unknown;
    background?: boolean;
  };
  // A background turn (a job's, a wake's) is not the panel streaming an answer.
  if (
    notification.method === 'turn.started' &&
    params.turnId !== undefined &&
    params.background !== true
  ) {
    desktop?.activeTurns.add(params.turnId);
  }
  if (
    (notification.method === 'turn.completed' || notification.method === 'turn.error') &&
    params.turnId !== undefined
  ) {
    desktop?.activeTurns.delete(params.turnId);
  }
  if (notification.method === 'pet.remark') showRemark(notification.params);
  // A change Scout wants to make in a connected app: the confirm card must be seen.
  if (notification.method === 'connector.confirm') bringUpBubble(true);

  // The renderer speaks the UI package's TurnEvent shape: the wire params plus the
  // method as a discriminant.
  const event = { type: notification.method, ...params };
  // A remark shown as the quiet line (panel hidden) must not also reach the mounted bubble.
  const panel = desktop?.panel;
  const bubbleDeaf = notification.method === 'pet.remark' && !panelWasVisible;
  for (const window of BrowserWindow.getAllWindows()) {
    if (bubbleDeaf && window === panel) continue;
    window.webContents.send(IPC.turnEvent, event);
  }
}

/**
 * Shows the bubble if it is hidden; `focus` gives it the keyboard, for something to answer.
 * Returns whether it was hidden and is now up.
 */
function bringUpBubble(focus: boolean): boolean {
  const panel = desktop?.panel;
  const avatar = desktop?.avatar;
  if (panel == null || avatar == null || panel.isVisible()) return false;
  if (focus) showPanelBeside(panel, avatar);
  else showPanelQuietly(panel, avatar);
  return true;
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
 * Settings is a page of Home.
 */
function openSettingsPage(target?: unknown): void {
  openHome(fixPage(target));
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

  const handle: IpcHandle = (channel, listener) =>
    ipcMain.handle(channel, listener as (event: unknown, ...args: unknown[]) => unknown);

  registerTurnIpc(handle, {
    brain: required().brain,
    claimTurn: (turnId) => claimTurn(turnId),
    status: () => brainStatus,
    pendingSnapshot: () => required().pendingSnapshot,
    takeDrop: () => drops.take(),
  });
  registerScoutIpc(handle);
  registerSpendIpc(handle, { brain: required().brain });
  registerConnectionIpc(handle, {
    brain: required().brain,
    answer: (ask, decision) => required().brain.answer(ask, decision),
    reply: (ask, option, text) => required().brain.answerWith(ask, option, text),
  });
  registerMemoryIpc(handle, { brain: required().brain });
  registerPermissionsIpc(handle, { brain: required().brain });
  registerJobsIpc(handle, { brain: required().brain });
  registerApprovalsIpc(handle, { brain: required().brain });
  registerBrainLinkIpc(handle, { brain: required().brain });
  registerSettingsIpc(handle, {
    settingsStore: () => required().settingsStore,
    secrets: () => required().secrets,
    problem: () => {
      const current = required();
      return current.hotkeyError;
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
  registerBrowserIpc(handle, {
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    exists: existsSync,
    showItemInFolder: (path) => shell.showItemInFolder(path),
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
  // The health card's Open logs folder: the person picks what to send; no log text moves.
  ipcMain.handle(IPC.openLogsFolder, () =>
    openLogsFolder(logsDir(), (path) => shell.openPath(path)),
  );
  ipcMain.handle(IPC.openHome, () => openHome());

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
    const { avatar } = required();
    if (avatar === null) return;
    const [x, y] = avatar.getPosition();
    rememberAvatarSpot({ x: x ?? null, y: y ?? null });
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

  ipcMain.handle(IPC.hidePanel, () => required().panel?.hide());
  ipcMain.handle(IPC.togglePanel, () => {
    const current = required();
    if (current.panel?.isVisible() === true) {
      current.panel.hide();
    } else openPanelNow(current);
  });
}
