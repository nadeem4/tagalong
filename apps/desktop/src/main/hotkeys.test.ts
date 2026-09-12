import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ASK_HOTKEY, registerAskHotkey } from './hotkeys';
import type { HotkeyRegistrar } from './hotkeys';

vi.mock('electron', () => ({ globalShortcut: undefined }));

function registrar(register: HotkeyRegistrar['register']): HotkeyRegistrar {
  return { register, unregisterAll: () => {} };
}

describe('registerAskHotkey', () => {
  it('registers the configured accelerator and reports success', () => {
    const register = vi.fn(() => true);

    const outcome = registerAskHotkey({
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

    registerAskHotkey({
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
    const outcome = registerAskHotkey({
      accelerator: 'CommandOrControl+Shift+Space',
      registrar: registrar(() => false),
      onTrigger: () => {},
    });

    expect(outcome.registered).toBe(false);
    expect(outcome.error).toMatch(/CommandOrControl\+Shift\+Space/);
  });

  it('turns a thrown registration error into the same reported outcome', () => {
    const outcome = registerAskHotkey({
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
