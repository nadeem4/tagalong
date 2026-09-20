import { globalShortcut } from 'electron';

/** The text-only ask. Cheap on purpose: no screenshot rides along with it. */
export const DEFAULT_ASK_HOTKEY = 'CommandOrControl+Shift+Space';

/**
 * The looking ask: selection, active window and a screenshot together.
 *
 * Split from the ask hotkey because a screenshot costs roughly 1,500 extra input tokens
 * per question. Charging that to every quick ask would make the cheap path expensive, so
 * the user chooses which one they are pressing.
 */
export const DEFAULT_LOOK_HOTKEY = 'CommandOrControl+Shift+S';

/**
 * The full-view ask: every display, the composite, and the window inventory.
 *
 * A third key rather than a modifier on the looking one, because the three differ in what
 * they cost and the user is choosing the bill. This one carries two images and a list of
 * everything open; the looking key carries one image; the ask key carries none.
 */
export const DEFAULT_SEE_EVERYTHING_HOTKEY = 'CommandOrControl+Shift+Alt+S';

/**
 * Turns all sight off and on again.
 *
 * Paired with the full-view key rather than given an unrelated combination: the key that
 * shows the pet everything and the key that blinds it are the two halves of one decision,
 * and a user reaching for the second is usually reacting to the first.
 *
 * This is the one hotkey whose loss matters, so the tray carries the same action. A user
 * who needs to blind the pet right now must not first have to find out that something
 * else on their machine already owns this combination.
 */
export const DEFAULT_PAUSE_SIGHT_HOTKEY = 'CommandOrControl+Shift+Alt+P';

/** The part of Electron globalShortcut this module uses, so tests can supply their own. */
export interface HotkeyRegistrar {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

export interface HotkeyOutcome {
  accelerator: string;
  registered: boolean;
  /** Which action this accelerator was meant to trigger. */
  action: keyof HotkeyBindings;
  /** Present only on failure, so the caller can show the user what went wrong. */
  error?: string;
}

/** What each hotkey is bound to, as the user has it in Settings. */
export interface HotkeyBindings {
  ask: string;
  look: string;
  seeEverything: string;
  pauseSight: string;
}

export interface RegisterHotkeyOptions {
  accelerator: string;
  action: keyof HotkeyBindings;
  onTrigger: () => void;
  registrar?: HotkeyRegistrar;
}

/**
 * What each action is called when a user is being told it stopped working.
 *
 * The key names are ours; these are what the settings window labels them, so a message
 * about a broken binding points at a control the reader can actually find.
 */
const ACTION_LABELS: { readonly [K in keyof HotkeyBindings]: string } = {
  ask: 'Ask',
  look: 'Look',
  seeEverything: 'See everything',
  pauseSight: 'Pause sight',
};

/**
 * Turns registration outcomes into something worth showing a user, or null.
 *
 * Names the action rather than only the accelerator, because four hotkeys do four
 * different things and "Ctrl+Shift+Alt+S could not be registered" does not say which one
 * the user has lost. It also says the others still work: a user whose see-everything key
 * died has no way to tell whether the rest survived, and silence on that reads as "hotkeys
 * are broken" when the honest state is that exactly one is.
 */
export function describeHotkeyProblems(outcomes: readonly HotkeyOutcome[]): string | null {
  const refused = outcomes.filter((outcome) => !outcome.registered);
  if (refused.length === 0) return null;

  const lines = refused.map(
    (outcome) =>
      `${ACTION_LABELS[outcome.action]} (${outcome.accelerator}): ` +
      (outcome.error ?? 'it could not be registered.'),
  );
  const survivors = outcomes.length - refused.length;

  return [
    refused.length === 1
      ? 'One hotkey could not be registered.'
      : `${refused.length} hotkeys could not be registered.`,
    ...lines,
    survivors > 0
      ? 'Every other hotkey still works. Pick a different combination in Settings.'
      : 'Pick different combinations in Settings, or use the tray.',
  ].join('\n');
}

/**
 * Registers one hotkey and reports the outcome instead of throwing.
 *
 * Electron returns false when another app already owns the combo and throws on a
 * malformed accelerator. Both are things the user can fix, and both are invisible unless
 * the caller is handed something to show — a pet that silently never answers its hotkey
 * looks like a broken app.
 */
export function registerHotkey(options: RegisterHotkeyOptions): HotkeyOutcome {
  const { accelerator, action, onTrigger, registrar = globalShortcut } = options;

  try {
    if (registrar.register(accelerator, onTrigger)) {
      return { accelerator, action, registered: true };
    }
    return {
      accelerator,
      action,
      registered: false,
      error: `Another application already owns ${accelerator}. Pick a different hotkey in Settings.`,
    };
  } catch (error) {
    return {
      accelerator,
      action,
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface HotkeyManagerOptions {
  onAsk: () => void;
  onLook: () => void;
  onSeeEverything: () => void;
  onPauseSight: () => void;
  registrar?: HotkeyRegistrar;
}

/**
 * Holds every hotkey and swaps them when the user edits one.
 *
 * The manager exists because rebinding has to happen while the app runs: telling someone
 * to restart Tagalong to pick up a hotkey they just typed is the kind of paper cut that
 * reads as a bug. Only the accelerators that actually changed are touched, so the one the
 * user did not edit is never briefly dead.
 *
 * One refused accelerator costs only its own action. Another application owning the
 * full-view key must not take the cheap ask down with it.
 */
export class HotkeyManager {
  readonly #registrar: HotkeyRegistrar;
  readonly #triggers: {
    ask: () => void;
    look: () => void;
    seeEverything: () => void;
    pauseSight: () => void;
  };
  /** Accelerators currently held by this process, keyed by action. */
  readonly #bound = new Map<keyof HotkeyBindings, string>();

  constructor(options: HotkeyManagerOptions) {
    this.#registrar = options.registrar ?? globalShortcut;
    this.#triggers = {
      ask: options.onAsk,
      look: options.onLook,
      seeEverything: options.onSeeEverything,
      pauseSight: options.onPauseSight,
    };
  }

  /** Applies the bindings, one outcome per action in ask, look, see-everything, pause order. */
  apply(bindings: HotkeyBindings): HotkeyOutcome[] {
    return (['ask', 'look', 'seeEverything', 'pauseSight'] as const).map((action) =>
      this.#bind(action, bindings[action]),
    );
  }

  /** Releases everything this manager holds, for quit. */
  dispose(): void {
    for (const accelerator of this.#bound.values()) this.#registrar.unregister(accelerator);
    this.#bound.clear();
  }

  #bind(action: keyof HotkeyBindings, accelerator: string): HotkeyOutcome {
    const held = this.#bound.get(action);
    if (held === accelerator) return { accelerator, action, registered: true };
    if (held !== undefined) {
      this.#registrar.unregister(held);
      this.#bound.delete(action);
    }

    const outcome = registerHotkey({
      accelerator,
      action,
      onTrigger: () => this.#triggers[action](),
      registrar: this.#registrar,
    });
    if (outcome.registered) this.#bound.set(action, accelerator);
    return outcome;
  }
}
