/** Tests for binding, rebinding and reporting the global shortcuts. */

import { describe, expect, it, vi } from 'vitest';
import { SETTINGS_DEFAULTS } from '@tagalong/protocol';
import {
  DEFAULT_PAUSE_SIGHT_HOTKEY,
  DEFAULT_STOP_VOICE_HOTKEY,
  HotkeyManager,
  describeHotkeyProblems,
  registerHotkey,
} from './hotkeys';
import type { HotkeyRegistrar } from './hotkeys';

/** The ask key a fresh install starts with. */
const ASK_HOTKEY = SETTINGS_DEFAULTS.hotkeys.ask;

vi.mock('electron', () => ({ globalShortcut: undefined }));

function registrar(register: HotkeyRegistrar['register']): HotkeyRegistrar {
  return { register, unregister: () => {}, unregisterAll: () => {} };
}

/** A registrar that remembers what is bound, so a rebind can be checked end to end. */
function recordingRegistrar(refuse: readonly string[] = []): HotkeyRegistrar & {
  bound: Map<string, () => void>;
  unregistered: string[];
} {
  const bound = new Map<string, () => void>();
  const unregistered: string[] = [];
  return {
    bound,
    unregistered,
    register: (accelerator, callback) => {
      if (refuse.includes(accelerator)) return false;
      bound.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      unregistered.push(accelerator);
      bound.delete(accelerator);
    },
    unregisterAll: () => bound.clear(),
  };
}

describe('registerHotkey', () => {
  it('registers the configured accelerator and reports success', () => {
    const register = vi.fn(() => true);

    const outcome = registerHotkey({
      accelerator: ASK_HOTKEY,
      action: 'ask',
      registrar: registrar(register),
      onTrigger: () => {},
    });

    expect(outcome).toEqual({ accelerator: ASK_HOTKEY, action: 'ask', registered: true });
    expect(register).toHaveBeenCalledWith(ASK_HOTKEY, expect.any(Function));
  });

  it('runs the trigger when the shortcut fires', () => {
    let fire = () => {};
    const onTrigger = vi.fn();

    registerHotkey({
      accelerator: 'CommandOrControl+Shift+Space',
      action: 'ask',
      registrar: registrar((_accelerator, callback) => {
        fire = callback;
        return true;
      }),
      onTrigger,
    });
    fire();

    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('reports a combo another app already owns instead of failing silently', () => {
    const outcome = registerHotkey({
      accelerator: 'CommandOrControl+Shift+Space',
      action: 'ask',
      registrar: registrar(() => false),
      onTrigger: () => {},
    });

    expect(outcome.registered).toBe(false);
    expect(outcome.error).toMatch(/CommandOrControl\+Shift\+Space/);
  });

  it('turns a thrown registration error into the same reported outcome', () => {
    const outcome = registerHotkey({
      accelerator: 'Bogus+Accelerator',
      action: 'ask',
      registrar: registrar(() => {
        throw new Error('Invalid accelerator');
      }),
      onTrigger: () => {},
    });

    expect(outcome.registered).toBe(false);
    expect(outcome.error).toContain('Invalid accelerator');
  });
});

const BOTH = {
  ask: ASK_HOTKEY,
  pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
  stopVoice: DEFAULT_STOP_VOICE_HOTKEY,
};

describe('HotkeyManager', () => {
  function manager(
    registrarToUse: HotkeyRegistrar,
    triggers: { onAsk?: () => void; onPauseSight?: () => void; onStopVoice?: () => void } = {},
  ): HotkeyManager {
    return new HotkeyManager({
      onAsk: triggers.onAsk ?? (() => {}),
      onPauseSight: triggers.onPauseSight ?? (() => {}),
      onStopVoice: triggers.onStopVoice ?? (() => {}),
      registrar: registrarToUse,
    });
  }

  it('binds the three hotkeys, ask, pause and stop voice, and reports each as registered', () => {
    const reg = recordingRegistrar();

    const outcomes = manager(reg).apply(BOTH);

    // Each outcome carries its action, so a refusal can name the thing the user lost
    // rather than only the combination that failed.
    expect(outcomes).toEqual([
      { accelerator: ASK_HOTKEY, action: 'ask', registered: true },
      { accelerator: DEFAULT_PAUSE_SIGHT_HOTKEY, action: 'pauseSight', registered: true },
      { accelerator: DEFAULT_STOP_VOICE_HOTKEY, action: 'stopVoice', registered: true },
    ]);
    expect([...reg.bound.keys()]).toEqual([
      ASK_HOTKEY,
      DEFAULT_PAUSE_SIGHT_HOTKEY,
      DEFAULT_STOP_VOICE_HOTKEY,
    ]);
  });

  it('has defaults that do not collide', () => {
    // A duplicate accelerator does not error, it silently steals the other action.
    expect(ASK_HOTKEY).not.toBe(DEFAULT_PAUSE_SIGHT_HOTKEY);
  });

  it('routes each accelerator to its own action', () => {
    const reg = recordingRegistrar();
    const fired: string[] = [];
    manager(reg, {
      onAsk: () => fired.push('ask'),
      onPauseSight: () => fired.push('pauseSight'),
    }).apply(BOTH);

    reg.bound.get(DEFAULT_PAUSE_SIGHT_HOTKEY)?.();
    reg.bound.get(ASK_HOTKEY)?.();

    expect(fired).toEqual(['pauseSight', 'ask']);
  });

  it('rebinds without a restart: the old accelerator is unregistered, the new one registered', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply(BOTH);
    const registerAfter = vi.spyOn(reg, 'register');

    held.apply({ ...BOTH, ask: 'Alt+Space' });

    // Only the key that changed is touched: the other is never briefly dead.
    expect(reg.unregistered).toEqual([ASK_HOTKEY]);
    expect(registerAfter).toHaveBeenCalledExactlyOnceWith('Alt+Space', expect.any(Function));
    expect([...reg.bound.keys()].sort()).toEqual(
      ['Alt+Space', DEFAULT_PAUSE_SIGHT_HOTKEY, DEFAULT_STOP_VOICE_HOTKEY].sort(),
    );
  });

  it('reports the rejected accelerator and still binds the other one', () => {
    // Pause is the one hotkey whose loss matters most, and the tray item is why losing it
    // is survivable. Losing it must not cost the ask.
    const reg = recordingRegistrar([DEFAULT_PAUSE_SIGHT_HOTKEY]);

    const outcomes = manager(reg).apply(BOTH);

    expect(outcomes[1]?.registered).toBe(false);
    expect(outcomes[1]?.error).toMatch(/CommandOrControl\+Shift\+Alt\+P/);
    expect(reg.bound.has(ASK_HOTKEY)).toBe(true);
  });

  it('retries an accelerator that was refused the first time', () => {
    const reg = recordingRegistrar([ASK_HOTKEY]);
    const held = manager(reg);
    held.apply(BOTH);

    const outcomes = held.apply({ ...BOTH, ask: 'Alt+Space' });

    expect(outcomes[0]).toEqual({ accelerator: 'Alt+Space', action: 'ask', registered: true });
    expect(reg.bound.has('Alt+Space')).toBe(true);
  });

  it('releases every accelerator on dispose', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply(BOTH);

    held.dispose();

    expect(reg.bound.size).toBe(0);
  });
});

describe('the stop voice hotkey', () => {
  it('defaults to Ctrl+Shift+Alt+M and stops Scout speaking when pressed', () => {
    expect(DEFAULT_STOP_VOICE_HOTKEY).toBe('CommandOrControl+Shift+Alt+M');
    const reg = recordingRegistrar();
    const onStopVoice = vi.fn();
    new HotkeyManager({
      onAsk: () => {},
      onPauseSight: () => {},
      onStopVoice,
      registrar: reg,
    }).apply(BOTH);
    reg.bound.get(DEFAULT_STOP_VOICE_HOTKEY)?.();
    expect(onStopVoice).toHaveBeenCalledOnce();
  });

  it('is named in words when it cannot be registered', () => {
    const problem = describeHotkeyProblems([
      { accelerator: 'X', action: 'stopVoice', registered: false },
    ]);
    expect(problem).toContain('Stop speaking (X)');
  });
});

describe('the talk key', () => {
  it('is no global shortcut: the key hook watches it, so the manager never binds it', () => {
    const reg = recordingRegistrar();
    const outcomes = new HotkeyManager({
      onAsk: () => {},
      onPauseSight: () => {},
      onStopVoice: () => {},
      registrar: reg,
    }).apply(BOTH);
    expect(outcomes.map((outcome) => outcome.action)).not.toContain('talk');
    expect(reg.bound.size).toBe(3);
  });

  it('is named in words when it could not start', () => {
    const problem = describeHotkeyProblems([
      { accelerator: 'Right Ctrl', action: 'talk', registered: false, error: 'no hook' },
    ]);
    expect(problem).toContain('Talk to Scout (Right Ctrl): no hook');
  });
});

describe('the pause hotkey', () => {
  it('defaults to Ctrl+Shift+Alt+P', () => {
    expect(DEFAULT_PAUSE_SIGHT_HOTKEY).toBe('CommandOrControl+Shift+Alt+P');
  });
});

describe('describeHotkeyProblems', () => {
  const ok = { accelerator: 'A', registered: true, action: 'ask' } as const;

  it('says nothing when every hotkey bound', () => {
    expect(describeHotkeyProblems([ok])).toBeNull();
  });

  it('names the action in words a user recognises, and the accelerator', () => {
    const problem = describeHotkeyProblems([
      ok,
      {
        accelerator: 'CommandOrControl+Shift+Alt+P',
        registered: false,
        action: 'pauseSight',
        error: 'Another application already owns it.',
      },
    ]);

    expect(problem).toContain('Pause sight');
    expect(problem).toContain('CommandOrControl+Shift+Alt+P');
    expect(problem).toContain('Another application already owns it.');
  });

  it('reports every failure rather than only the first', () => {
    const problem = describeHotkeyProblems([
      { accelerator: 'X', registered: false, action: 'ask' },
      { accelerator: 'Y', registered: false, action: 'pauseSight' },
    ]);

    expect(problem).toContain('Ask');
    expect(problem).toContain('Pause sight');
  });

  it('says the rest still work, because that is the thing the user cannot see', () => {
    // A user whose pause key died has no way to tell whether the ask survived. Silence on that reads as "hotkeys are broken", and the honest state is
    // that exactly one is.
    const problem = describeHotkeyProblems([
      ok,
      { accelerator: 'X', registered: false, action: 'pauseSight' },
    ]);
    expect(problem?.toLowerCase()).toContain('other');
  });
});
