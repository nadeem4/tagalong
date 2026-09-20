import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ASK_HOTKEY,
  DEFAULT_LOOK_HOTKEY,
  DEFAULT_SEE_EVERYTHING_HOTKEY,
  HotkeyManager,
  registerHotkey,
} from './hotkeys';
import type { HotkeyRegistrar } from './hotkeys';

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
      accelerator: DEFAULT_ASK_HOTKEY,
      registrar: registrar(register),
      onTrigger: () => {},
    });

    expect(outcome).toEqual({ accelerator: DEFAULT_ASK_HOTKEY, registered: true });
    expect(register).toHaveBeenCalledWith(DEFAULT_ASK_HOTKEY, expect.any(Function));
  });

  it('runs the trigger when the shortcut fires', () => {
    let fire = () => {};
    const onTrigger = vi.fn();

    registerHotkey({
      accelerator: 'CommandOrControl+Shift+Space',
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
      registrar: registrar(() => false),
      onTrigger: () => {},
    });

    expect(outcome.registered).toBe(false);
    expect(outcome.error).toMatch(/CommandOrControl\+Shift\+Space/);
  });

  it('turns a thrown registration error into the same reported outcome', () => {
    const outcome = registerHotkey({
      accelerator: 'Bogus+Accelerator',
      registrar: registrar(() => {
        throw new Error('Invalid accelerator');
      }),
      onTrigger: () => {},
    });

    expect(outcome.registered).toBe(false);
    expect(outcome.error).toContain('Invalid accelerator');
  });
});

describe('HotkeyManager', () => {
  function manager(
    registrarToUse: HotkeyRegistrar,
    triggers: { onAsk?: () => void; onLook?: () => void; onSeeEverything?: () => void } = {},
  ): HotkeyManager {
    return new HotkeyManager({
      onAsk: triggers.onAsk ?? (() => {}),
      onLook: triggers.onLook ?? (() => {}),
      onSeeEverything: triggers.onSeeEverything ?? (() => {}),
      registrar: registrarToUse,
    });
  }

  it('binds every hotkey and reports each as registered', () => {
    const reg = recordingRegistrar();

    const outcomes = manager(reg).apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    expect(outcomes).toEqual([
      { accelerator: DEFAULT_ASK_HOTKEY, registered: true },
      { accelerator: DEFAULT_LOOK_HOTKEY, registered: true },
      { accelerator: DEFAULT_SEE_EVERYTHING_HOTKEY, registered: true },
    ]);
    expect([...reg.bound.keys()]).toEqual([
      DEFAULT_ASK_HOTKEY,
      DEFAULT_LOOK_HOTKEY,
      DEFAULT_SEE_EVERYTHING_HOTKEY,
    ]);
  });

  it('routes each accelerator to its own action', () => {
    const reg = recordingRegistrar();
    const onAsk = vi.fn();
    const onLook = vi.fn();

    manager(reg, { onAsk, onLook }).apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });
    reg.bound.get(DEFAULT_LOOK_HOTKEY)?.();

    expect(onLook).toHaveBeenCalledOnce();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('rebinds without a restart: the old accelerator is unregistered, the new one registered', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    held.apply({
      ask: 'Alt+Space',
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    expect(reg.unregistered).toEqual([DEFAULT_ASK_HOTKEY]);
    expect([...reg.bound.keys()].sort()).toEqual(
      ['Alt+Space', DEFAULT_LOOK_HOTKEY, DEFAULT_SEE_EVERYTHING_HOTKEY].sort(),
    );
  });

  it('leaves an unchanged accelerator bound rather than dropping it for an instant', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });
    const registerAfter = vi.spyOn(reg, 'register');

    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: 'Alt+S',
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    expect(reg.unregistered).toEqual([DEFAULT_LOOK_HOTKEY]);
    expect(registerAfter).toHaveBeenCalledExactlyOnceWith('Alt+S', expect.any(Function));
  });

  it('reports the rejected accelerator and still binds the other one', () => {
    const reg = recordingRegistrar([DEFAULT_LOOK_HOTKEY]);

    const outcomes = manager(reg).apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    expect(outcomes[1]?.registered).toBe(false);
    expect(outcomes[1]?.error).toMatch(/CommandOrControl\+Shift\+S/);
    expect(reg.bound.has(DEFAULT_ASK_HOTKEY)).toBe(true);
  });

  it('retries an accelerator that was refused the first time', () => {
    const reg = recordingRegistrar([DEFAULT_LOOK_HOTKEY]);
    const held = manager(reg);
    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    const outcomes = held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: 'Alt+S',
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    expect(outcomes[1]).toEqual({ accelerator: 'Alt+S', registered: true });
    expect(reg.bound.has('Alt+S')).toBe(true);
  });

  it('releases every accelerator on dispose', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    });

    held.dispose();

    expect(reg.bound.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2B: the see-everything hotkey
// ---------------------------------------------------------------------------

describe('the see-everything hotkey', () => {
  function seeing(
    registrarToUse: HotkeyRegistrar,
    onSeeEverything: () => void = () => {},
  ): HotkeyManager {
    return new HotkeyManager({
      onAsk: () => {},
      onLook: () => {},
      onSeeEverything,
      registrar: registrarToUse,
    });
  }

  const ALL_THREE = {
    ask: DEFAULT_ASK_HOTKEY,
    look: DEFAULT_LOOK_HOTKEY,
    seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
  };

  it('has a default that collides with neither of the other two', () => {
    // A duplicate accelerator does not error, it silently steals the other action: the
    // second register wins and the first hotkey stops working with nothing said.
    expect(new Set(Object.values(ALL_THREE)).size).toBe(3);
  });

  it('binds all three and reports one outcome each', () => {
    const reg = recordingRegistrar();
    const outcomes = seeing(reg).apply(ALL_THREE);

    expect(outcomes).toHaveLength(3);
    expect(outcomes.every((outcome) => outcome.registered)).toBe(true);
    expect([...reg.bound.keys()]).toContain(DEFAULT_SEE_EVERYTHING_HOTKEY);
  });

  it('fires its own trigger and not one of the others', () => {
    const reg = recordingRegistrar();
    const onSeeEverything = vi.fn();
    seeing(reg, onSeeEverything).apply(ALL_THREE);

    reg.bound.get(DEFAULT_SEE_EVERYTHING_HOTKEY)?.();

    expect(onSeeEverything).toHaveBeenCalledOnce();
  });

  it('rebinds only the key that changed', () => {
    const reg = recordingRegistrar();
    const held = seeing(reg);
    held.apply(ALL_THREE);
    reg.unregistered.length = 0;

    held.apply({ ...ALL_THREE, seeEverything: 'Alt+Shift+S' });

    expect(reg.unregistered).toEqual([DEFAULT_SEE_EVERYTHING_HOTKEY]);
  });

  it('releases all three on dispose', () => {
    const reg = recordingRegistrar();
    const held = seeing(reg);
    held.apply(ALL_THREE);

    held.dispose();

    expect(reg.unregistered).toHaveLength(3);
  });

  it('keeps the other two working when this one is refused', () => {
    // Another app owning Ctrl+Shift+Alt+S must not cost the user the cheap ask.
    const reg = recordingRegistrar([DEFAULT_SEE_EVERYTHING_HOTKEY]);
    const outcomes = seeing(reg).apply(ALL_THREE);

    const refused = outcomes.filter((outcome) => !outcome.registered);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.accelerator).toBe(DEFAULT_SEE_EVERYTHING_HOTKEY);
  });
});
