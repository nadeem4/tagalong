import { globalShortcut } from 'electron';

/** What the phase page specifies, and what Settings shows until Phase 7 makes it editable. */
export const DEFAULT_ASK_HOTKEY = 'CommandOrControl+Shift+Space';

/** The part of Electron globalShortcut this module uses, so tests can supply their own. */
export interface HotkeyRegistrar {
  register(accelerator: string, callback: () => void): boolean;
  unregisterAll(): void;
}

export interface HotkeyOutcome {
  accelerator: string;
  registered: boolean;
  /** Present only on failure, so the caller can show the user what went wrong. */
  error?: string;
}

export interface RegisterAskHotkeyOptions {
  accelerator: string;
  onTrigger: () => void;
  registrar?: HotkeyRegistrar;
}

/**
 * Registers the ask hotkey and reports the outcome instead of throwing.
 *
 * Electron returns false when another app already owns the combo and throws on a
 * malformed accelerator. Both are things the user can fix, and both are invisible unless
 * the caller is handed something to show — a pet that silently never answers its hotkey
 * looks like a broken app.
 */
export function registerAskHotkey(options: RegisterAskHotkeyOptions): HotkeyOutcome {
  const { accelerator, onTrigger, registrar = globalShortcut } = options;

  try {
    if (registrar.register(accelerator, onTrigger)) {
      return { accelerator, registered: true };
    }
    return {
      accelerator,
      registered: false,
      error: `Another application already owns ${accelerator}. Pick a different hotkey in Settings.`,
    };
  } catch (error) {
    return {
      accelerator,
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
