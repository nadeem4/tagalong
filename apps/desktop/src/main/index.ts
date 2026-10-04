import { randomUUID } from 'node:crypto';
import { BrowserWindow, Menu, Tray, app, dialog, ipcMain, screen } from 'electron';
import { ContextSnapshot } from '@tagalong/protocol';
import type { PerceptionTarget, Pet, Settings, SettingsPatch } from '@tagalong/protocol';
import { SettingsStore } from '@tagalong/core';
import { captureNotice, captureTooltip } from './capture-notice';
import { captureAskSnapshot, capturePatch } from './context';
import { startEngineHost } from './engine-host';
import { providerChoices, secretKeyFor } from './provider-choices';
import type { EngineHost } from './engine-host';
import {
  DEFAULT_LOOK_HOTKEY,
  DEFAULT_PAUSE_SIGHT_HOTKEY,
  DEFAULT_SEE_EVERYTHING_HOTKEY,
  HotkeyManager,
  describeHotkeyProblems,
} from './hotkeys';
import { createPlatform } from './platform/index';
import { gateSight } from './platform/sight-gate';
import { SightPause } from './sight-pause';
import type { Platform } from './platform/index';
import { SafeStorageSecretStore } from './secret-store';
import { createTrayIcon } from './tray-icon';
import { createAvatarWindow } from './windows/avatar';
import { createPanelWindow, showPanelBeside } from './windows/panel';
import { AVATAR_SIZE, resolveAvatarPosition, stripWidth } from './windows/position';
import { createSettingsWindow } from './windows/settings';
import { IPC } from '../shared/ipc';
import type { CaptureNotice, HostView, ModelList } from '../shared/ipc';

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
  /** The snapshot the last hotkey captured, handed to the panel and sent with the ask. */
  pendingSnapshot: ContextSnapshot | null;
  /** Turn ids in flight: the panel must not vanish on focus loss mid-answer. */
  activeTurns: Set<string>;
  hotkeys: HotkeyManager;
  hotkeyError: string | null;
  /** Whether the user has sight turned off. Read by the platform gate on every read. */
  sightPause: SightPause;
}

let desktop: Desktop | null = null;

/**
 * A second launch focuses the pet that is already running.
 *
 * Two engines would fight over the same port and the same SQLite file, so the lock is
 * taken before anything else happens.
 */
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
    pendingSnapshot: null,
    activeTurns: new Set(),
    hotkeys: new HotkeyManager({
      onAsk: () => void openPanelWithContext({ screenshot: false }),
      onLook: () => void openPanelWithContext({ screenshot: true }),
      onSeeEverything: () => void openPanelWithContext({ screenshot: false, fullView: true }),
      onPauseSight: () => toggleSightPause(),
    }),
    hotkeyError: null,
    sightPause,
  };

  // The avatar greys its eye and the tray shows a checkmark, so both follow one state
  // rather than each remembering to ask.
  sightPause.onChange((paused) => {
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

  desktop.panel = createPanelWindow({ isStreaming: () => (desktop?.activeTurns.size ?? 0) > 0 });
  desktop.avatar = createAvatarWindow({
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
    look: settings.hotkeys.look ?? DEFAULT_LOOK_HOTKEY,
    seeEverything: settings.hotkeys.seeEverything ?? DEFAULT_SEE_EVERYTHING_HOTKEY,
    pauseSight: settings.hotkeys.pauseSight ?? DEFAULT_PAUSE_SIGHT_HOTKEY,
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

  // The renderer speaks the UI package's TurnEvent shape: the wire params plus the
  // method as a discriminant.
  const event = { type: notification.method, ...params };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.turnEvent, event);
  }
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
  return Menu.buildFromTemplate([
    {
      label: 'Show or hide pets',
      click: () => {
        if (desktop?.avatar === null || desktop === null) return;
        if (desktop.avatar?.isVisible() === true) {
          desktop.avatar.hide();
          desktop.panel?.hide();
        } else {
          desktop.avatar?.show();
        }
      },
    },
    {
      label: 'Pause sight',
      type: 'checkbox',
      checked: desktop?.sightPause.paused ?? false,
      click: () => toggleSightPause(),
    },
    { label: 'Settings', click: openSettings },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
}

function createTray(): Tray {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip('Tagalong');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', () => void openPanelWithContext({ screenshot: false }));
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
 * The hotkey path: perceive, announce it, then open the panel with what was found.
 *
 * What is captured separates the three hotkeys, and each costs more than the last. The
 * text-only one carries no picture. The looking one carries a screenshot, roughly 1,500
 * extra input tokens. The full-view one carries the composite, the focused display and a
 * list of everything open.
 */
async function openPanelWithContext(options: {
  screenshot: boolean;
  fullView?: boolean;
}): Promise<void> {
  if (desktop === null || desktop.panel === null || desktop.avatar === null) return;

  const { snapshot, blocked, paused } = await captureAskSnapshot(desktop.platform, {
    screenshot: options.screenshot,
    ...(options.fullView === undefined ? {} : { fullView: options.fullView }),
    exclusions: desktop.settings.captureExclusions,
  });
  desktop.pendingSnapshot = snapshot;

  // A full-view capture is a capture: the eye badge and the tray tooltip have to fire for
  // it too, or the loudest kind of look is the only silent one.
  announceCapture(
    captureNotice({
      at: new Date(),
      screenshot: options.screenshot || options.fullView === true,
      blocked,
      paused,
    }),
  );
  desktop.panel.webContents.send(IPC.contextEvent, snapshot);
  desktop.avatar.show();
  showPanelBeside(desktop.panel, desktop.avatar);
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
    async (_event, input: { petId: string; conversationId?: string; text?: string }) => {
      const snapshot = required().pendingSnapshot;
      return engine().client.call('ask', {
        petId: input.petId,
        ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
        input: { text: input.text ?? '' },
        ...(snapshot !== null ? { snapshot } : {}),
      });
    },
  );

  ipcMain.handle(IPC.interrupt, async (_event, turnId: string) => {
    await engine().client.call('interrupt', { turnId });
  });

  ipcMain.handle(IPC.listPets, async (): Promise<Pet[]> => {
    const result = await engine().client.call('pets.list', {});
    return result.pets;
  });

  ipcMain.handle(IPC.getContext, () => required().pendingSnapshot);
  // A window that opened after the last toggle has missed the event, and an avatar that
  // shows sight running while it is paused is the one lie this feature cannot afford.
  ipcMain.handle(IPC.getSightPaused, () => required().sightPause.paused);
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
    return {
      settings,
      pets,
      providers: providerChoices(stored),
      engineVersion: app.getVersion(),
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
    return saved;
  });

  ipcMain.handle(IPC.saveApiKey, async (_event, providerId: string, apiKey: string) => {
    const { secrets } = required();
    const secretKey = secretKeyFor(providerId);
    if (secretKey === undefined) throw new Error(`'${providerId}' does not take an API key`);
    if (apiKey.length === 0) await secrets.delete(secretKey);
    else await secrets.set(secretKey, apiKey);
  });

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
  ipcMain.handle(IPC.selectPet, async (_event, petId: string) => {
    const current = required();
    if (current.panel?.isVisible() !== true) await openPanelWithContext({ screenshot: false });
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

  ipcMain.handle(IPC.openSettings, () => openSettings());
  ipcMain.handle(IPC.hidePanel, () => required().panel?.hide());
  ipcMain.handle(IPC.togglePanel, async () => {
    const current = required();
    if (current.panel?.isVisible() === true) current.panel.hide();
    else await openPanelWithContext({ screenshot: false });
  });
}
