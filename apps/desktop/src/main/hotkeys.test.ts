import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ASK_HOTKEY,
  DEFAULT_LOOK_HOTKEY,
  DEFAULT_PAUSE_SIGHT_HOTKEY,
  DEFAULT_SEE_EVERYTHING_HOTKEY,
  HotkeyManager,
  describeHotkeyProblems,
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
      action: 'ask',
      registrar: registrar(register),
      onTrigger: () => {},
    });

    expect(outcome).toEqual({ accelerator: DEFAULT_ASK_HOTKEY, action: 'ask', registered: true });
    expect(register).toHaveBeenCalledWith(DEFAULT_ASK_HOTKEY, expect.any(Function));
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

describe('HotkeyManager', () => {
  function manager(
    registrarToUse: HotkeyRegistrar,
    triggers: { onAsk?: () => void; onLook?: () => void; onSeeEverything?: () => void } = {},
  ): HotkeyManager {
    return new HotkeyManager({
      onAsk: triggers.onAsk ?? (() => {}),
      onLook: triggers.onLook ?? (() => {}),
      onSeeEverything: triggers.onSeeEverything ?? (() => {}),
      onPauseSight: () => {},
      registrar: registrarToUse,
    });
  }

  it('binds every hotkey and reports each as registered', () => {
    const reg = recordingRegistrar();

    const outcomes = manager(reg).apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    // Each outcome carries its action, so a refusal can name the thing the user lost
    // rather than only the combination that failed.
    expect(outcomes).toEqual([
      { accelerator: DEFAULT_ASK_HOTKEY, action: 'ask', registered: true },
      { accelerator: DEFAULT_LOOK_HOTKEY, action: 'look', registered: true },
      { accelerator: DEFAULT_SEE_EVERYTHING_HOTKEY, action: 'seeEverything', registered: true },
      { accelerator: DEFAULT_PAUSE_SIGHT_HOTKEY, action: 'pauseSight', registered: true },
    ]);
    expect([...reg.bound.keys()]).toEqual([
      DEFAULT_ASK_HOTKEY,
      DEFAULT_LOOK_HOTKEY,
      DEFAULT_SEE_EVERYTHING_HOTKEY,
      DEFAULT_PAUSE_SIGHT_HOTKEY,
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
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
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
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    held.apply({
      ask: 'Alt+Space',
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    expect(reg.unregistered).toEqual([DEFAULT_ASK_HOTKEY]);
    expect([...reg.bound.keys()].sort()).toEqual(
      [
        'Alt+Space',
        DEFAULT_LOOK_HOTKEY,
        DEFAULT_SEE_EVERYTHING_HOTKEY,
        DEFAULT_PAUSE_SIGHT_HOTKEY,
      ].sort(),
    );
  });

  it('leaves an unchanged accelerator bound rather than dropping it for an instant', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });
    const registerAfter = vi.spyOn(reg, 'register');

    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: 'Alt+S',
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
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
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
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
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    const outcomes = held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: 'Alt+S',
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    expect(outcomes[1]).toEqual({ accelerator: 'Alt+S', action: 'look', registered: true });
    expect(reg.bound.has('Alt+S')).toBe(true);
  });

  it('releases every accelerator on dispose', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
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
      onPauseSight: () => {},
      registrar: registrarToUse,
    });
  }

  const ALL_THREE = {
    ask: DEFAULT_ASK_HOTKEY,
    look: DEFAULT_LOOK_HOTKEY,
    seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
    pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
  };

  it('has a default that collides with none of the others', () => {
    // A duplicate accelerator does not error, it silently steals the other action: the
    // second register wins and the first hotkey stops working with nothing said. Counted
    // against the fixture's own size so adding a fifth key keeps the check honest.
    const all = Object.values(ALL_THREE);
    expect(new Set(all).size).toBe(all.length);
  });

  it('binds every action and reports one outcome each', () => {
    const reg = recordingRegistrar();
    const outcomes = seeing(reg).apply(ALL_THREE);

    // Four since the pause hotkey joined them. The number is asserted rather than the
    // list, because what this test protects is that one refusal costs only its own
    // action — not which keys exist.
    expect(outcomes).toHaveLength(4);
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

  it('releases every hotkey on dispose', () => {
    const reg = recordingRegistrar();
    const held = seeing(reg);
    held.apply(ALL_THREE);

    held.dispose();

    expect(reg.unregistered).toHaveLength(Object.keys(ALL_THREE).length);
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

// ---------------------------------------------------------------------------
// Phase 2B task 8: the pause hotkey
// ---------------------------------------------------------------------------

describe('the pause hotkey', () => {
  it('defaults to Ctrl+Shift+Alt+P', () => {
    expect(DEFAULT_PAUSE_SIGHT_HOTKEY).toBe('CommandOrControl+Shift+Alt+P');
  });

  it('binds alongside the other three', () => {
    const recorder = recordingRegistrar();
    const manager = new HotkeyManager({
      onAsk: () => {},
      onLook: () => {},
      onSeeEverything: () => {},
      onPauseSight: () => {},
      registrar: recorder,
    });

    const outcomes = manager.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    expect(outcomes).toHaveLength(4);
    expect(outcomes.every((outcome) => outcome.registered)).toBe(true);
    expect([...recorder.bound.keys()].sort()).toEqual(
      [
        DEFAULT_ASK_HOTKEY,
        DEFAULT_LOOK_HOTKEY,
        DEFAULT_SEE_EVERYTHING_HOTKEY,
        DEFAULT_PAUSE_SIGHT_HOTKEY,
      ].sort(),
    );
  });

  it('fires its own trigger and nobody else’s', () => {
    const recorder = recordingRegistrar();
    const fired: string[] = [];
    const manager = new HotkeyManager({
      onAsk: () => fired.push('ask'),
      onLook: () => fired.push('look'),
      onSeeEverything: () => fired.push('seeEverything'),
      onPauseSight: () => fired.push('pauseSight'),
      registrar: recorder,
    });
    manager.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    recorder.bound.get(DEFAULT_PAUSE_SIGHT_HOTKEY)?.();

    expect(fired).toEqual(['pauseSight']);
  });

  it('keeps working when another app owns the pause key', () => {
    // Pause is the one hotkey whose loss matters most, and it is also the most likely to
    // collide. Losing it must not cost the user the keys that still work — and the tray
    // item is why losing it is survivable at all.
    const recorder = recordingRegistrar([DEFAULT_PAUSE_SIGHT_HOTKEY]);
    const manager = new HotkeyManager({
      onAsk: () => {},
      onLook: () => {},
      onSeeEverything: () => {},
      onPauseSight: () => {},
      registrar: recorder,
    });

    const outcomes = manager.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    expect(outcomes[3]?.registered).toBe(false);
    expect(outcomes.slice(0, 3).every((outcome) => outcome.registered)).toBe(true);
  });
});

describe('a hotkey that cannot be registered', () => {
  it('names which action failed, not only the accelerator', () => {
    // "Ctrl+Shift+Alt+S could not be registered" tells a user nothing about what they
    // have lost. The point of four hotkeys is that they do different things, so the
    // message has to say which one stopped working.
    const manager = new HotkeyManager({
      onAsk: () => {},
      onLook: () => {},
      onSeeEverything: () => {},
      onPauseSight: () => {},
      registrar: recordingRegistrar([DEFAULT_SEE_EVERYTHING_HOTKEY]),
    });

    const outcomes = manager.apply({
      ask: DEFAULT_ASK_HOTKEY,
      look: DEFAULT_LOOK_HOTKEY,
      seeEverything: DEFAULT_SEE_EVERYTHING_HOTKEY,
      pauseSight: DEFAULT_PAUSE_SIGHT_HOTKEY,
    });

    expect(outcomes.map((outcome) => outcome.action)).toEqual([
      'ask',
      'look',
      'seeEverything',
      'pauseSight',
    ]);
    const refused = outcomes.find((outcome) => !outcome.registered);
    expect(refused?.action).toBe('seeEverything');
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
        accelerator: 'CommandOrControl+Shift+Alt+S',
        registered: false,
        action: 'seeEverything',
        error: 'Another application already owns it.',
      },
    ]);

    expect(problem).toContain('See everything');
    expect(problem).toContain('CommandOrControl+Shift+Alt+S');
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
    // A user whose see-everything key died has no way to tell whether the other three
    // survived. Silence on that reads as "hotkeys are broken", and the honest state is
    // that exactly one is.
    const problem = describeHotkeyProblems([
      ok,
      { accelerator: 'X', registered: false, action: 'look' },
    ]);
    expect(problem?.toLowerCase()).toContain('other');
  });
});
