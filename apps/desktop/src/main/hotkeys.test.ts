import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ASK_HOTKEY, DEFAULT_LOOK_HOTKEY, HotkeyManager, registerHotkey } from './hotkeys';
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
    triggers: { onAsk?: () => void; onLook?: () => void } = {},
  ): HotkeyManager {
    return new HotkeyManager({
      onAsk: triggers.onAsk ?? (() => {}),
      onLook: triggers.onLook ?? (() => {}),
      registrar: registrarToUse,
    });
  }

  it('binds both hotkeys and reports both as registered', () => {
    const reg = recordingRegistrar();

    const outcomes = manager(reg).apply({ ask: DEFAULT_ASK_HOTKEY, look: DEFAULT_LOOK_HOTKEY });

    expect(outcomes).toEqual([
      { accelerator: DEFAULT_ASK_HOTKEY, registered: true },
      { accelerator: DEFAULT_LOOK_HOTKEY, registered: true },
    ]);
    expect([...reg.bound.keys()]).toEqual([DEFAULT_ASK_HOTKEY, DEFAULT_LOOK_HOTKEY]);
  });

  it('routes each accelerator to its own action', () => {
    const reg = recordingRegistrar();
    const onAsk = vi.fn();
    const onLook = vi.fn();

    manager(reg, { onAsk, onLook }).apply({ ask: DEFAULT_ASK_HOTKEY, look: DEFAULT_LOOK_HOTKEY });
    reg.bound.get(DEFAULT_LOOK_HOTKEY)?.();

    expect(onLook).toHaveBeenCalledOnce();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('rebinds without a restart: the old accelerator is unregistered, the new one registered', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({ ask: DEFAULT_ASK_HOTKEY, look: DEFAULT_LOOK_HOTKEY });

    held.apply({ ask: 'Alt+Space', look: DEFAULT_LOOK_HOTKEY });

    expect(reg.unregistered).toEqual([DEFAULT_ASK_HOTKEY]);
    expect([...reg.bound.keys()].sort()).toEqual(['Alt+Space', DEFAULT_LOOK_HOTKEY].sort());
  });

  it('leaves an unchanged accelerator bound rather than dropping it for an instant', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({ ask: DEFAULT_ASK_HOTKEY, look: DEFAULT_LOOK_HOTKEY });
    const registerAfter = vi.spyOn(reg, 'register');

    held.apply({ ask: DEFAULT_ASK_HOTKEY, look: 'Alt+S' });

    expect(reg.unregistered).toEqual([DEFAULT_LOOK_HOTKEY]);
    expect(registerAfter).toHaveBeenCalledExactlyOnceWith('Alt+S', expect.any(Function));
  });

  it('reports the rejected accelerator and still binds the other one', () => {
    const reg = recordingRegistrar([DEFAULT_LOOK_HOTKEY]);

    const outcomes = manager(reg).apply({ ask: DEFAULT_ASK_HOTKEY, look: DEFAULT_LOOK_HOTKEY });

    expect(outcomes[1]?.registered).toBe(false);
    expect(outcomes[1]?.error).toMatch(/CommandOrControl\+Shift\+S/);
    expect(reg.bound.has(DEFAULT_ASK_HOTKEY)).toBe(true);
  });

  it('retries an accelerator that was refused the first time', () => {
    const reg = recordingRegistrar([DEFAULT_LOOK_HOTKEY]);
    const held = manager(reg);
    held.apply({ ask: DEFAULT_ASK_HOTKEY, look: DEFAULT_LOOK_HOTKEY });

    const outcomes = held.apply({ ask: DEFAULT_ASK_HOTKEY, look: 'Alt+S' });

    expect(outcomes[1]).toEqual({ accelerator: 'Alt+S', registered: true });
    expect(reg.bound.has('Alt+S')).toBe(true);
  });

  it('releases every accelerator on dispose', () => {
    const reg = recordingRegistrar();
    const held = manager(reg);
    held.apply({ ask: DEFAULT_ASK_HOTKEY, look: DEFAULT_LOOK_HOTKEY });

    held.dispose();

    expect(reg.bound.size).toBe(0);
  });
});
