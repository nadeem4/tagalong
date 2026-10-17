/** Tests for WatchManager: thresholds, settling, checks, timeouts and stop. */
import { describe, expect, it } from 'vitest';
import type { PerceptionDiffParams, PerceptionDiffResult, Pet, Settings } from '@tagalong/protocol';
import type { BrainProvider, BrainRequest, BrainResult } from '../providers';
import type { PerceptionHost } from '../perception';
import { FakeClock } from './fake-clock';
import {
  WATCH_CHANGE_THRESHOLD,
  WATCH_POLL_MS,
  WATCH_SETTLE_MS,
  WatchManager,
  type WatchEvent,
} from './watch-manager';

const pet: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🐾',
  model: 'claude-opus-5',
  providerId: 'anthropic',
  roleId: 'generalist',
};

const LIMITS: Settings['watch'] = { maxChecks: 60, maxConcurrent: 3, defaultTimeoutMinutes: 30 };
const CROP = { mime: 'image/png' as const, base64: 'YWZ0ZXI=', width: 300, height: 40 };

/**
 * A screen whose content is a version number that the test bumps. Every diff remembers
 * the version at that moment, the way the desktop's scratch ring remembers frames, and a
 * diff compares now with the remembered version nearest `sinceSeconds` ago.
 */
function screenHost(clock: FakeClock, changedRatio = 0.08) {
  const history: Array<{ at: number; version: number }> = [];
  const diffs: PerceptionDiffParams[] = [];
  const state = { version: 0, failing: false, text: 'building...' };
  const host: PerceptionHost = {
    capabilities: ['displays', 'recall', 'textLayer'],
    capture: () => Promise.resolve({}),
    diff: (params): Promise<PerceptionDiffResult> => {
      diffs.push(params);
      if (state.failing) return Promise.reject(new Error('sight is paused'));
      const now = clock.now();
      const target = now - params.sinceSeconds * 1000;
      const earlier = history
        .filter((entry) => entry.at < now)
        .sort((a, b) => Math.abs(a.at - target) - Math.abs(b.at - target))[0];
      history.push({ at: now, version: state.version });
      const afterAt = new Date(now).toISOString();
      if (earlier === undefined) return Promise.resolve({ changeRatio: 0, afterAt });
      const changed = earlier.version !== state.version;
      return Promise.resolve({
        changeRatio: changed ? changedRatio : 0,
        beforeAt: new Date(earlier.at).toISOString(),
        afterAt,
        ...(changed ? { bounds: { x: 0, y: 700, width: 300, height: 40 } } : {}),
        ...(changed && params.includeImages !== false ? { before: CROP, after: CROP } : {}),
      });
    },
    readText: (params) =>
      Promise.resolve({
        windowId: params.windowId ?? 'w1',
        text: state.text,
        truncated: false,
        source: 'uia' as const,
      }),
  };
  return { host, diffs, state, imageDiffs: () => diffs.filter((d) => d.includeImages !== false) };
}

/** A check model that answers from a queue and records every request. */
function checker(answers: string[], options: { vision?: boolean } = {}) {
  const requests: BrainRequest[] = [];
  const provider: BrainProvider = {
    id: 'checker',
    capabilities: { vision: options.vision ?? true, tools: true },
    complete: (req): Promise<BrainResult> => {
      requests.push(req);
      const text = answers.shift() ?? '{"answer":"no","reason":"Nothing yet."}';
      return Promise.resolve({
        text,
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
    },
  };
  return { provider, requests };
}

function setup(
  options: {
    answers?: string[];
    limits?: Partial<Settings['watch']>;
    vision?: boolean;
    changedRatio?: number;
  } = {},
) {
  const clock = new FakeClock(Date.parse('2026-10-04T10:00:00.000Z'));
  const screen = screenHost(clock, options.changedRatio);
  const check = checker(options.answers ?? [], {
    ...(options.vision === undefined ? {} : { vision: options.vision }),
  });
  const events: WatchEvent[] = [];
  const manager = new WatchManager({
    clock,
    hosts: () => [screen.host],
    provider: () => check.provider,
    limits: () => ({ ...LIMITS, ...options.limits }),
    emit: (event) => events.push(event),
  });
  const statuses = () =>
    events.filter((event) => event.method === 'watch.status').map((event) => event.params.state);
  const fired = () => events.filter((event) => event.method === 'watch.fired');
  return { clock, screen, check, events, manager, statuses, fired };
}

async function started(
  manager: WatchManager,
  extra: Partial<Parameters<WatchManager['start']>[0]> = {},
) {
  const outcome = await manager.start({
    pet,
    condition: 'the build finishes',
    displayId: 1,
    ...extra,
  });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.watchId;
}

describe('WatchManager', () => {
  it('announces the watch and asks the model nothing while the screen is still', async () => {
    const { clock, check, manager, statuses } = setup();
    await started(manager);
    await clock.advance(5 * 60_000);
    expect(statuses()).toEqual(['watching']);
    expect(check.requests).toHaveLength(0);
  });

  it('names the check model in its status', async () => {
    const { manager, events } = setup();
    await started(manager);
    expect(events[0]?.params).toMatchObject({ checkModel: 'claude-haiku-4-5' });
  });

  it('polls with a local diff and no images until something changes', async () => {
    const { clock, screen, manager } = setup();
    await started(manager);
    await clock.advance(WATCH_POLL_MS * 4);
    expect(screen.diffs.length).toBeGreaterThan(4);
    expect(screen.imageDiffs()).toHaveLength(0);
  });

  it('checks once when the region changes and settles, and fires on yes', async () => {
    const { clock, screen, check, manager, statuses, fired } = setup({
      answers: ['{"answer":"yes","reason":"The terminal shows Build succeeded."}'],
    });
    const watchId = await started(manager);
    await clock.advance(WATCH_POLL_MS * 2);

    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS + WATCH_SETTLE_MS);

    expect(check.requests).toHaveLength(1);
    expect(fired()).toEqual([
      {
        method: 'watch.fired',
        params: {
          watchId,
          petId: 'scout',
          condition: 'the build finishes',
          message: 'The terminal shows Build succeeded.',
          displayId: 1,
        },
      },
    ]);
    expect(statuses()).toEqual(['watching', 'fired']);
    // The watch is over: nothing more is polled.
    const polls = screen.diffs.length;
    await clock.advance(WATCH_POLL_MS * 5);
    expect(screen.diffs.length).toBe(polls);
    expect(manager.active()).toHaveLength(0);
  });

  it('fires with an empty message when the judge gives no reason, never a made-up line', async () => {
    const { clock, screen, manager, fired } = setup({ answers: ['{"answer":"yes"}'] });
    await started(manager);
    await clock.advance(WATCH_POLL_MS * 2);
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS + WATCH_SETTLE_MS);
    expect(fired()[0]?.params).toMatchObject({ condition: 'the build finishes', message: '' });
  });

  it('fires within ten seconds of the change', async () => {
    const { clock, screen, manager, fired } = setup({
      answers: ['{"answer":"yes","reason":"Done."}'],
    });
    await started(manager);
    await clock.advance(WATCH_POLL_MS * 3 + 1_000);
    screen.state.version = 1;
    await clock.advance(10_000);
    expect(fired()).toHaveLength(1);
  });

  it('sends the check model the after crop and the condition, asking for yes or no', async () => {
    const { clock, screen, check, manager } = setup({
      answers: ['{"answer":"no","reason":"Still compiling."}'],
    });
    await started(manager);
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 3);

    const request = check.requests[0]!;
    expect(request.model).toBe('claude-haiku-4-5');
    expect(request.system).toMatch(/yes/);
    expect(request.tools).toBeUndefined();
    const content = request.messages[0]!.content;
    expect(content).toContainEqual({ type: 'image', mime: 'image/png', base64: CROP.base64 });
    expect(JSON.stringify(content)).toContain('the build finishes');
  });

  it('asks at most once per change: a no moves the baseline, so a still screen is not rechecked', async () => {
    const { clock, screen, check, manager, statuses } = setup();
    await started(manager);
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 20);
    expect(check.requests).toHaveLength(1);
    expect(statuses()).toEqual(['watching', 'watching']);

    screen.state.version = 2;
    await clock.advance(WATCH_POLL_MS * 20);
    expect(check.requests).toHaveLength(2);
  });

  it('waits for a screen that keeps changing to settle before asking', async () => {
    const { clock, screen, check, manager } = setup();
    await started(manager);
    for (let i = 1; i <= 10; i += 1) {
      screen.state.version = i;
      await clock.advance(WATCH_SETTLE_MS);
    }
    expect(check.requests).toHaveLength(0);
    await clock.advance(WATCH_POLL_MS * 2);
    expect(check.requests).toHaveLength(1);
  });

  it('ignores a change below the threshold', async () => {
    const { clock, screen, check, manager } = setup({ changedRatio: WATCH_CHANGE_THRESHOLD / 2 });
    await started(manager);
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 6);
    expect(check.requests).toHaveLength(0);
  });

  it('ends the watch when it has spent its checks', async () => {
    const { clock, screen, check, manager, events } = setup({ limits: { maxChecks: 3 } });
    await started(manager);
    for (let i = 1; i <= 6; i += 1) {
      screen.state.version = i;
      await clock.advance(WATCH_POLL_MS * 3);
    }
    expect(check.requests).toHaveLength(3);
    const last = events.at(-1);
    expect(last?.method).toBe('watch.status');
    expect(last?.params).toMatchObject({ state: 'capped', checks: 3, maxChecks: 3 });
    expect(manager.active()).toHaveLength(0);
  });

  it('enforces 60 checks by default', async () => {
    const { clock, screen, check, manager } = setup();
    await started(manager);
    for (let i = 1; i <= 70; i += 1) {
      screen.state.version = i;
      await clock.advance(WATCH_POLL_MS * 3);
    }
    expect(check.requests).toHaveLength(60);
  });

  it('ends the watch at its timeout', async () => {
    const { clock, manager, statuses } = setup();
    await started(manager, { timeoutMinutes: 2 });
    await clock.advance(2 * 60_000 + WATCH_POLL_MS);
    expect(statuses()).toEqual(['watching', 'timeout']);
    expect(manager.active()).toHaveLength(0);
  });

  it('uses the configured default timeout when the pet names none', async () => {
    const { clock, manager, statuses } = setup({ limits: { defaultTimeoutMinutes: 1 } });
    await started(manager);
    await clock.advance(60_000 + WATCH_POLL_MS);
    expect(statuses()).toContain('timeout');
  });

  it('refuses a fourth watch while three run', async () => {
    const { manager } = setup();
    await started(manager);
    await started(manager);
    await started(manager);
    const fourth = await manager.start({ pet, condition: 'x', displayId: 1 });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.reason).toMatch(/3/);
  });

  it('stops on request, and Stop is final', async () => {
    const { clock, screen, check, manager, statuses } = setup();
    const watchId = await started(manager);
    expect(manager.stop(watchId)).toBe(true);
    expect(manager.stop(watchId)).toBe(false);
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 5);
    expect(check.requests).toHaveLength(0);
    expect(statuses()).toEqual(['watching', 'stopped']);
  });

  it('keeps watching through a host that refuses for a while, such as a pause', async () => {
    const { clock, screen, check, manager } = setup({
      answers: ['{"answer":"yes","reason":"Done."}'],
    });
    await started(manager);
    screen.state.failing = true;
    await clock.advance(WATCH_POLL_MS * 4);
    screen.state.failing = false;
    await clock.advance(WATCH_POLL_MS * 2);
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 3);
    expect(check.requests).toHaveLength(1);
  });

  it('refuses to start without a host that can diff', async () => {
    const clock = new FakeClock(0);
    const manager = new WatchManager({
      clock,
      hosts: () => [],
      provider: () => checker([]).provider,
      limits: () => LIMITS,
      emit: () => undefined,
    });
    const outcome = await manager.start({ pet, condition: 'x', displayId: 1 });
    expect(outcome.ok).toBe(false);
  });

  it('reads the watched window text when the check model cannot see', async () => {
    const { clock, screen, check, manager } = setup({
      answers: ['{"answer":"yes","reason":"The log says done."}'],
      vision: false,
    });
    await started(manager, { windowId: 'w1', pet: { ...pet, providerId: 'openrouter' } });
    screen.state.text = 'compiling...\nDone in 42s';
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 3);

    const request = check.requests[0]!;
    expect(request.model).toBe('anthropic/claude-haiku-4.5');
    expect(JSON.stringify(request.messages)).toContain('Done in 42s');
    expect(JSON.stringify(request.messages)).not.toContain(CROP.base64);
  });

  it('ends the watch with an error when the check model is blind and there is no text', async () => {
    const { clock, screen, check, manager, statuses } = setup({ vision: false });
    await started(manager, { pet: { ...pet, providerId: 'openrouter' } });
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 3);

    expect(check.requests).toHaveLength(0);
    expect(statuses()).toEqual(['watching', 'error']);
  });

  it('reads a plain yes even when the model ignores the JSON format', async () => {
    const { clock, screen, manager, fired } = setup({ answers: ['Yes — the download finished.'] });
    await started(manager);
    screen.state.version = 1;
    await clock.advance(WATCH_POLL_MS * 3);
    expect(fired()).toHaveLength(1);
  });

  it('stopAll ends every watch, for shutdown', async () => {
    const { clock, manager } = setup();
    await started(manager);
    await started(manager);
    manager.stopAll();
    expect(manager.active()).toHaveLength(0);
    expect(clock.pendingTimers).toBe(0);
  });
});
