/** Tests for gatherHealth: each row, budgets and calls that fail or hang. */
import { describe, expect, it, vi } from 'vitest';
import { Settings } from '../../shared/settings';
import type { HostView } from '../../shared/ipc';
import { gatherHealth } from './health-facts';
import type { HealthDeps } from './health-facts';

function view(patch: Partial<HostView> = {}, settings: Record<string, unknown> = {}): HostView {
  return {
    settings: Settings.parse(settings),
    pets: [{ id: 'scout', name: 'Scout', avatar: '🦊' }],
    appVersion: '0.0.0',
    platform: 'win32',
    elevenLabsKeyStored: false,
    ...patch,
  };
}

function deps(patch: Partial<HealthDeps> = {}): HealthDeps {
  return {
    getHostView: () => Promise.resolve(view()),
    listConnections: () =>
      Promise.resolve({
        apps: [
          {
            id: 'github',
            name: 'GitHub',
            transport: 'http' as const,
            auth: 'oauth' as const,
            enabled: true,
            status: 'needs-sign-in' as const,
            error: '',
            tools: [],
          },
        ],
      }),
    listMicrophones: () => Promise.resolve([{ id: 'mic-1', label: 'Desk mic' }]),
    voiceModels: () => Promise.resolve({ mouth: true, ears: false }),
    testBudgetMs: 5_000,
    ...patch,
  };
}

describe('gatherHealth', () => {
  it('reads every check from the host’s own calls', async () => {
    const facts = await gatherHealth(deps());
    expect(facts).toEqual({
      connections: [{ name: 'GitHub', status: 'needs-sign-in' }],
      voice: {
        enabled: true,
        mouth: 'kokoro',
        elevenLabsKey: false,
        mouthReady: true,
        earsUsed: false,
        earsReady: false,
      },
      microphone: { count: 1, pickedMissing: false },
    });
  });

  it('reads a picked microphone that is gone', async () => {
    const facts = await gatherHealth(
      deps({
        getHostView: () =>
          Promise.resolve(
            view({}, { voice: { ...Settings.parse({}).voice, microphoneId: 'usb' } }),
          ),
      }),
    );
    expect(facts.microphone).toEqual({ count: 1, pickedMissing: true });
  });

  it('counts the ears as in use when Always listening is on', async () => {
    const facts = await gatherHealth(
      deps({ getHostView: () => Promise.resolve(view({}, { listening: { always: true } })) }),
    );
    expect(facts.voice).toMatchObject({ earsUsed: true, earsReady: false });
  });

  it('turns each call that fails into unknown, and never throws', async () => {
    const fail = () => Promise.reject(new Error('down'));
    const facts = await gatherHealth({
      getHostView: fail,
      listConnections: fail,
      listMicrophones: fail,
      voiceModels: fail,
      testBudgetMs: 5_000,
    });
    expect(facts).toEqual({
      connections: 'unknown',
      voice: 'unknown',
      microphone: 'unknown',
    });
  });

  it('gives up on any call that hangs: that row is unknown, the rest still read', async () => {
    vi.useFakeTimers();
    try {
      const hang = () => new Promise<never>(() => undefined);
      const pending = gatherHealth(
        deps({
          listConnections: hang,
          listMicrophones: hang,
          voiceModels: hang,
          testBudgetMs: 5_000,
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toEqual({
        connections: 'unknown',
        voice: 'unknown',
        microphone: 'unknown',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a host view that hangs, and says the voice is unknown', async () => {
    vi.useFakeTimers();
    try {
      let settled = false;
      const pending = gatherHealth(
        deps({
          getHostView: () => new Promise<never>(() => undefined),
          testBudgetMs: 5_000,
        }),
      ).then((facts) => {
        settled = true;
        return facts;
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).toBe(true);
      expect((await pending).voice).toBe('unknown');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never carries a key, only whether one is stored', async () => {
    const facts = await gatherHealth(
      deps({
        getHostView: () =>
          Promise.resolve(
            view(
              { elevenLabsKeyStored: true },
              { voice: { ...Settings.parse({}).voice, mouth: 'elevenlabs' } },
            ),
          ),
      }),
    );
    expect(facts.voice).toMatchObject({ mouth: 'elevenlabs', elevenLabsKey: true });
  });
});
