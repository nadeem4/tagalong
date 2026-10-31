/**
 * IPC for the first-run walkthrough: walkthrough:open (clears the seen mark, opens the window at
 * a step) and walkthrough:finish (sets it, closes the window). Contains registerWalkthroughIpc.
 * Only Finish and Skip write `done: true`; closing the window never does.
 */

import type { SettingsPatch } from '../../shared/settings';
import { IPC } from '../../shared/ipc';
import type { IpcHandle } from './handle';

interface WalkthroughIpcDeps {
  /** Saves and broadcasts a settings patch (the same path as Settings). */
  save: (patch: SettingsPatch) => void;
  /** Opens or focuses the window, at a step when one is named. */
  open: (step?: number) => void;
  close: () => void;
}

/** The step a window asked for, or undefined: only a positive whole number counts. */
function stepOf(input: unknown): number | undefined {
  const step = (input as { step?: unknown } | undefined)?.step;
  return typeof step === 'number' && Number.isInteger(step) && step > 0 ? step : undefined;
}

export function registerWalkthroughIpc(handle: IpcHandle, deps: WalkthroughIpcDeps): void {
  handle(IPC.walkthroughOpen, (_event: unknown, input?: { step?: number }) => {
    deps.save({ walkthrough: { done: false } });
    deps.open(stepOf(input));
  });
  // Finish marks the tour seen but leaves the finish card up (close: false); the card's own
  // buttons then close the window. Skip tour and the card's buttons use the default (close).
  handle(IPC.walkthroughFinish, (_event: unknown, input?: { close?: boolean }) => {
    deps.save({ walkthrough: { done: true } });
    if (input?.close !== false) deps.close();
  });
}
