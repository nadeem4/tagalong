/**
 * A fake WalkthroughHost for the walkthrough's tests: records what the steps call and lets a
 * test pick the brain's key facts and the settings. Contains makeWalkthroughHost.
 */

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { KeyStatus } from '../host-bridge';
import { StepSaveContext } from './use-step-save';
import type { WalkthroughHost, WalkthroughSettings } from './walkthrough-host';

export const NO_KEY: KeyStatus = {
  hasKey: false,
  source: 'none',
  envPath: 'C:/home/.env',
  dailyLimitUsd: 5,
};

export const HAS_KEY: KeyStatus = { ...NO_KEY, hasKey: true, source: 'file' };

export const SETTINGS: WalkthroughSettings = {
  hotkeys: { ask: 'CommandOrControl+Shift+Space', pauseSight: 'CommandOrControl+Shift+Alt+P' },
  voice: { enabled: true, voice: 'bm_george', speed: 0.95 },
};

export function makeWalkthroughHost(
  options: { key?: KeyStatus | 'offline'; settings?: WalkthroughSettings } = {},
) {
  const key = options.key ?? NO_KEY;
  return {
    keyStatus: vi.fn(() =>
      key === 'offline' ? Promise.reject(new Error('offline')) : Promise.resolve({ ...key }),
    ),
    setKey: vi.fn(() => Promise.resolve('ok' as const)),
    setDailyLimit: vi.fn(() => Promise.resolve()),
    onBrainChanged: vi.fn(() => () => undefined),
    openWalkthrough: vi.fn(() => Promise.resolve()),
    expertStatus: vi.fn(() => Promise.resolve({ found: true, command: 'claude-agent-acp' })),
    finishWalkthrough: vi.fn(() => Promise.resolve()),
    getSettings: vi.fn(() => Promise.resolve(options.settings ?? SETTINGS)),
    saveSettings: vi.fn((_patch: unknown) => Promise.resolve()),
    previewVoice: vi.fn((_options: unknown) => Promise.resolve()),
    listMicrophones: vi.fn(() => Promise.resolve([{ id: 'mic-1', label: 'Desk microphone' }])),
  } satisfies WalkthroughHost;
}

/** Renders one step the way the shell does and returns what Next would call to save it. */
export function mountStep(step: ReactElement): { save(): Promise<void> } {
  let registered: (() => Promise<void>) | null = null;
  render(
    <StepSaveContext.Provider value={(save) => (registered = save)}>{step}</StepSaveContext.Provider>,
  );
  return { save: async () => registered?.() };
}
