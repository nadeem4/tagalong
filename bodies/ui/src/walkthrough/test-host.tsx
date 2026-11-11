/**
 * A fake WalkthroughHost for the walkthrough's tests: records what the steps call and lets a
 * test pick the brain's key facts and the settings. Contains makeWalkthroughHost.
 */

import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { MicWatcher } from '../controls';
import type { KeyResult, KeyStatus } from '../host-bridge';
import type { SetupOverview } from '../shapes';
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
    setKey: vi.fn((_key: string): Promise<KeyResult> => Promise.resolve('ok')),
    setDailyLimit: vi.fn(() => Promise.resolve()),
    usageSummary: vi.fn(() => Promise.resolve({ spentUsd: 0.42, limitUsd: 5 })),
    onBrainChanged: vi.fn((_handler: (what: string) => void) => () => undefined),
    openWalkthrough: vi.fn(() => Promise.resolve()),
    setupOverview: vi.fn((_query?: string): Promise<SetupOverview> =>
      Promise.resolve({
        experts: [],
        apps: [],
        browseExperts: [],
        browseApps: [],
        popular: [],
        popularMore: [],
        showMoreFrom: null,
        appGroups: [],
        nextCursor: null,
        sources: null,
        stale: false,
        progress: null,
        failed: null,
      }),
    ),
    setupExpert: vi.fn((_id: string): Promise<{ state?: string }> => Promise.resolve({})),
    setupApp: vi.fn((_id: string, _query: string): Promise<{ state?: string }> =>
      Promise.resolve({}),
    ),
    finishWalkthrough: vi.fn(() => Promise.resolve()),
    openKeyPage: vi.fn(() => Promise.resolve()),
    getSettings: vi.fn(() => Promise.resolve(options.settings ?? SETTINGS)),
    saveSettings: vi.fn((_patch: unknown) => Promise.resolve()),
    previewVoice: vi.fn((_options: unknown) => Promise.resolve()),
    listMicrophones: vi.fn(() => Promise.resolve([{ id: 'mic-1', label: 'Desk microphone' }])),
    watchMicLevel: vi.fn<MicWatcher>(() => ({ stop: vi.fn() })),
    browserFolder: vi.fn(() => Promise.resolve({ path: 'C:/app/browser/dist', exists: true })),
    showBrowserFolder: vi.fn(() => Promise.resolve()),
    copyText: vi.fn((_text: string) => Promise.resolve()),
    openHome: vi.fn(() => Promise.resolve()),
  } satisfies WalkthroughHost;
}

/** Renders one step the way the shell does and returns what Next would call to save it. */
export function mountStep(step: ReactElement): {
  save(): Promise<void>;
  /** True once the step has registered its save (effects run after the first paint). */
  registered(): boolean;
} {
  let registered: (() => Promise<void>) | null = null;
  render(
    <StepSaveContext.Provider value={(save) => (registered = save)}>
      {step}
    </StepSaveContext.Provider>,
  );
  return { save: async () => registered?.(), registered: () => registered !== null };
}
