import { describe, expect, it, vi } from 'vitest';
import { installCrashGuard, type CrashGuardProcess } from './crash-guard';

function fakeProcess() {
  const handlers = new Map<string, (reason: unknown) => void>();
  const proc: CrashGuardProcess = {
    on(event, handler) {
      handlers.set(event, handler);
    },
  };
  return { proc, handlers };
}

describe('installCrashGuard', () => {
  it('does nothing outside a test run, so Electron keeps its own crash handling', () => {
    const { proc, handlers } = fakeProcess();
    installCrashGuard({ enabled: false, process: proc, log: vi.fn(), exit: vi.fn() });
    expect(handlers.size).toBe(0);
  });

  it('logs an uncaught exception and exits with a failure instead of opening a modal', () => {
    const { proc, handlers } = fakeProcess();
    const log = vi.fn();
    const exit = vi.fn();
    installCrashGuard({ enabled: true, process: proc, log, exit });

    handlers.get('uncaughtException')?.(new Error('capture blew up'));

    expect(log).toHaveBeenCalledWith(expect.stringContaining('capture blew up'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('treats an unhandled rejection the same way', () => {
    const { proc, handlers } = fakeProcess();
    const log = vi.fn();
    const exit = vi.fn();
    installCrashGuard({ enabled: true, process: proc, log, exit });

    handlers.get('unhandledRejection')?.('a plain reason');

    expect(log).toHaveBeenCalledWith(expect.stringContaining('a plain reason'));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
