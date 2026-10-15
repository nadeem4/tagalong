import { describe, expect, it, vi } from 'vitest';
import { Settings } from '@tagalong/protocol';
import type { Expert, Pet } from '@tagalong/protocol';
import type { HostView } from '../../shared/ipc';
import { gatherHealth } from './health-facts';
import type { HealthDeps } from './health-facts';

const scout = { id: 'scout', name: 'Scout', providerId: 'claude-code', model: 'sonnet' } as Pet;

const expert = (id: string, enabled = true): Expert =>
  ({
    id,
    name: id === 'coder' ? 'Coder' : 'Writer',
    goodAt: '',
    enabled,
    instructions: '',
    connection: { type: 'claude-code', canEdit: false, canSearchWeb: false },
  }) as Expert;

function view(patch: Partial<HostView> = {}, settings: Record<string, unknown> = {}): HostView {
  return {
    settings: Settings.parse({ defaultPetId: 'scout', ...settings }),
    pets: [scout],
    providers: [],
    engineVersion: '0.0.0',
    watchModelDefaults: {},
    platform: 'win32',
    elevenLabsKeyStored: false,
    ...patch,
  };
}

function deps(patch: Partial<HealthDeps> = {}): HealthDeps {
  return {
    getHostView: () => Promise.resolve(view()),
    checkClaudeSignIn: () => Promise.resolve('signed-in'),
    listExperts: () => Promise.resolve([expert('coder'), expert('writer', false)]),
    testExpert: () => Promise.resolve({ ok: true }),
    listConnections: () =>
      Promise.resolve({
        connections: [
          {
            id: 'github',
            name: 'GitHub',
            transport: { type: 'http', url: 'https://example.com/mcp' },
            auth: { type: 'oauth' },
            secretNames: [],
            enabled: true,
            status: 'needs-sign-in',
            tools: [],
          },
        ],
        popular: [],
        found: [],
      } as never),
    listMicrophones: () => Promise.resolve([{ id: 'mic-1', label: 'Desk mic' }]),
    voiceModels: () => Promise.resolve({ mouth: true, ears: false }),
    hostsStatus: () => Promise.resolve({ extension: false }),
    testBudgetMs: 5_000,
    ...patch,
  };
}

describe('gatherHealth', () => {
  it('reads every check from the host’s own calls', async () => {
    const testExpert = vi.fn(() => Promise.resolve({ ok: false }));
    const facts = await gatherHealth(deps({ testExpert }));
    expect(facts).toEqual({
      brain: 'ready',
      // Only the experts that are on are tested.
      experts: [{ name: 'Coder', ok: false }],
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
      extension: false,
    });
    expect(testExpert).toHaveBeenCalledExactlyOnceWith('coder');
  });

  it('reads Scout signed out, and a picked microphone that is gone', async () => {
    const facts = await gatherHealth(
      deps({
        checkClaudeSignIn: () => Promise.resolve('signed-out'),
        getHostView: () =>
          Promise.resolve(
            view({}, { voice: { ...Settings.parse({}).voice, microphoneId: 'usb' } }),
          ),
      }),
    );
    expect(facts.brain).toBe('signed-out');
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
      checkClaudeSignIn: fail,
      listExperts: fail,
      testExpert: fail,
      listConnections: fail,
      listMicrophones: fail,
      voiceModels: fail,
      hostsStatus: fail,
      testBudgetMs: 5_000,
    });
    expect(facts).toEqual({
      brain: 'unknown',
      experts: 'unknown',
      connections: 'unknown',
      voice: 'unknown',
      microphone: 'unknown',
      extension: 'unknown',
    });
  });

  it('counts an expert whose test fails or takes too long as not reached', async () => {
    vi.useFakeTimers();
    try {
      const pending = gatherHealth(
        deps({
          listExperts: () => Promise.resolve([expert('coder'), expert('writer')]),
          testExpert: (id) =>
            id === 'coder' ? new Promise(() => undefined) : Promise.reject(new Error('no')),
          testBudgetMs: 5_000,
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect((await pending).experts).toEqual([
        { name: 'Coder', ok: false },
        { name: 'Writer', ok: false },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on any call that hangs: that row is unknown, the rest still read', async () => {
    vi.useFakeTimers();
    try {
      const hang = () => new Promise<never>(() => undefined);
      const pending = gatherHealth(
        deps({
          listExperts: hang,
          listConnections: hang,
          listMicrophones: hang,
          voiceModels: hang,
          hostsStatus: hang,
          testBudgetMs: 5_000,
        }),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toEqual({
        brain: 'ready',
        experts: 'unknown',
        connections: 'unknown',
        voice: 'unknown',
        microphone: 'unknown',
        extension: 'unknown',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a host view that hangs, and says the brain is unknown', async () => {
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
      expect((await pending).brain).toBe('unknown');
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
              { elevenLabsKeyStored: true, pairingToken: 'secret-token' },
              { voice: { ...Settings.parse({}).voice, mouth: 'elevenlabs' } },
            ),
          ),
      }),
    );
    expect(facts.voice).toMatchObject({ mouth: 'elevenlabs', elevenLabsKey: true });
    expect(JSON.stringify(facts)).not.toContain('secret-token');
  });
});
