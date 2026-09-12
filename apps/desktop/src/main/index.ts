import { BrowserWindow, Menu, Tray, app, dialog, ipcMain } from 'electron';
import type { ContextSnapshot, Pet, Settings, SettingsPatch } from '@tagalong/protocol';
import { SettingsStore } from '@tagalong/core';
import { captureAskSnapshot } from './context';
import { ANTHROPIC_KEY, startEngineHost } from './engine-host';
import type { EngineHost } from './engine-host';
import { DEFAULT_ASK_HOTKEY, registerAskHotkey } from './hotkeys';
import { createPlatform } from './platform/index';
import type { Platform } from './platform/index';
import { SafeStorageSecretStore } from './secret-store';
import { createTrayIcon } from './tray-icon';
import { createAvatarWindow } from './windows/avatar';
import { createPanelWindow, showPanelBeside } from './windows/panel';
import { createSettingsWindow } from './windows/settings';
import { IPC } from '../shared/ipc';
import type { HostView } from '../shared/ipc';

/** Everything the app owns once it is up. Assembled in `start`, torn down on quit. */
interface Desktop {
  /** Null when the engine refused to boot — see `start` for why that is survivable. */
  host: EngineHost | null;
  bootError: string | null;
  platform: Platform;
  settingsStore: SettingsStore;
  secrets: SafeStorageSecretStore;
  avatar: BrowserWindow | null;
  panel: BrowserWindow | null;
  tray: Tray;
  settingsWindow: BrowserWindow | null;
  /** The snapshot the last hotkey captured, handed to the panel and sent with the ask. */
  pendingSnapshot: ContextSnapshot | null;
  /** Turn ids in flight: the panel must not vanish on focus loss mid-answer. */
  activeTurns: Set<string>;
  hotkeyError: string | null;
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
  void desktop?.host?.shutdown();
});

async function start(): Promise<void> {
  const platform = createPlatform();
  const dataDir = app.getPath('userData');
  const secrets = new SafeStorageSecretStore(dataDir);
  const settingsStore = new SettingsStore(dataDir);

  let host: EngineHost | null = null;
  let bootError: string | null = null;
  try {
    host = await startEngineHost({
      dataDir,
      secrets,
      platform,
      onNotification: forwardToRenderers,
    });
  } catch (error) {
    // A missing API key is the ordinary first run, not a crash. Quitting here would leave
    // the user with no way to reach the settings window that fixes it.
    bootError = error instanceof Error ? error.message : String(error);
    console.error('[main] the engine did not start:', bootError);
  }

  const settings = settingsStore.get();

  desktop = {
    host,
    bootError,
    platform,
    settingsStore,
    secrets,
    avatar: null,
    panel: null,
    tray: createTray(),
    settingsWindow: null,
    pendingSnapshot: null,
    activeTurns: new Set(),
    hotkeyError: null,
  };

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

  const outcome = registerAskHotkey({
    accelerator: settings.hotkeys.ask || DEFAULT_ASK_HOTKEY,
    onTrigger: () => void openPanelWithContext(),
  });
  if (!outcome.registered) {
    desktop.hotkeyError = outcome.error ?? 'the hotkey could not be registered';
    console.error(`[main] ${desktop.hotkeyError}`);
    // Silence here would look like a broken app: the user would press the hotkey and get
    // nothing, with no way to learn that another program owns the combo.
    dialog.showErrorBox('Tagalong could not register its hotkey', desktop.hotkeyError);
  }
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

function createTray(): Tray {
  const tray = new Tray(createTrayIcon());
  tray.setToolTip('Tagalong');
  tray.setContextMenu(
    Menu.buildFromTemplate([
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
      { label: 'Settings', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
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

/** The hotkey path: look at the screen, then open the panel with what was found. */
async function openPanelWithContext(): Promise<void> {
  if (desktop === null || desktop.panel === null || desktop.avatar === null) return;
  desktop.pendingSnapshot = await captureAskSnapshot(desktop.platform);
  desktop.panel.webContents.send(IPC.contextEvent, desktop.pendingSnapshot);
  desktop.avatar.show();
  showPanelBeside(desktop.panel, desktop.avatar);
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

  ipcMain.handle(IPC.ask, async (_event, input: { petId: string; text?: string }) => {
    const snapshot = required().pendingSnapshot;
    return engine().client.call('ask', {
      petId: input.petId,
      input: { text: input.text ?? '' },
      ...(snapshot !== null ? { snapshot } : {}),
    });
  });

  ipcMain.handle(IPC.interrupt, async (_event, turnId: string) => {
    await engine().client.call('interrupt', { turnId });
  });

  ipcMain.handle(IPC.listPets, async (): Promise<Pet[]> => {
    const result = await engine().client.call('pets.list', {});
    return result.pets;
  });

  ipcMain.handle(IPC.getContext, () => required().pendingSnapshot);

  ipcMain.handle(IPC.hostView, async (): Promise<HostView> => {
    const current = required();
    const settings = await readSettings();
    const apiKey = await current.secrets.get(ANTHROPIC_KEY);
    const problem = current.hotkeyError ?? current.bootError;
    return {
      settings,
      hasApiKey: apiKey !== null && apiKey.length > 0,
      engineVersion: app.getVersion(),
      ...(problem !== null ? { hotkeyError: problem } : {}),
    };
  });

  ipcMain.handle(IPC.saveSettings, async (_event, patch: SettingsPatch): Promise<Settings> => {
    const current = required();
    if (current.host === null) return current.settingsStore.set(patch);
    return (await current.host.client.call('settings.set', { patch })).settings;
  });

  ipcMain.handle(IPC.saveApiKey, async (_event, apiKey: string) => {
    const { secrets } = required();
    if (apiKey.length === 0) await secrets.delete(ANTHROPIC_KEY);
    else await secrets.set(ANTHROPIC_KEY, apiKey);
  });

  ipcMain.handle(IPC.openSettings, () => openSettings());
  ipcMain.handle(IPC.hidePanel, () => required().panel?.hide());
  ipcMain.handle(IPC.togglePanel, async () => {
    const current = required();
    if (current.panel?.isVisible() === true) current.panel.hide();
    else await openPanelWithContext();
  });
}
