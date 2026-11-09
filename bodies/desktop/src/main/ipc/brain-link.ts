/**
 * IPC for Home's "Where things run" card: the address the desktop dials, whether the link
 * is up, and the first-run setup state (idle, installing, failed) with its Retry. Read from
 * the client and the launcher themselves, so no brain call is needed (and it works offline).
 * Contains registerBrainLinkIpc and createBrainSetup.
 */

import { IPC } from '../../shared/ipc';
import type { BrainStatus } from '@tagalong/contract';
import type { SetupState } from '../brain/launch';
import type { IpcHandle } from './handle';

export interface BrainSetup {
  readonly state: SetupState;
  /** Runs the launch (again, after a failure); ignored while one is already running. */
  retry: () => Promise<void>;
}

/** Holds the setup state the launcher reports; `onChange` tells Home to read it again. */
export function createBrainSetup(
  launch: (onSetup: (state: SetupState) => void) => Promise<void>,
  onChange: () => void,
): BrainSetup {
  let state: SetupState = 'idle';
  let running = false;
  const set = (next: SetupState): void => {
    state = next;
    onChange();
  };
  return {
    get state() {
      return state;
    },
    async retry() {
      if (running) return;
      running = true;
      try {
        await launch(set);
      } catch (error) {
        // launchBrain logs its own failures; a surprise must not leave Retry stuck.
        console.warn(`could not start the brain (${String(error)})`);
        set('failed');
      } finally {
        running = false;
      }
    },
  };
}

export function registerBrainLinkIpc(
  handle: IpcHandle,
  deps: { brain: { addr: string; link: BrainStatus }; setup: BrainSetup },
): void {
  const { brain, setup } = deps;
  handle(IPC.brainLink, () => ({
    addr: `ws://${brain.addr}`,
    status: brain.link,
    setup: setup.state,
  }));
  // Only after a failure: any other time a brain is starting or already running.
  handle(IPC.brainSetupRetry, () => (setup.state === 'failed' ? setup.retry() : undefined));
}
