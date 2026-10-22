/**
 * Tests for Sleep: when it runs, what the mind is shown, and the guardrails on what it may
 * change. A fake mind answers; no test pins the mind's wording.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { fakeMind, scout, sentText, type MindStep } from '../check-in/test-support';
import { openDatabase } from '../memory/db';
import { ExperienceLog } from '../memory/experience';
import { ConversationStore } from '../memory/store';
import { soul } from '../roles';
import { FakeClock } from '../watch/fake-clock';
import { AWAY_MS, MIN_EPISODES, SLEEP_GAP_MS, SLEEP_INSTRUCTIONS, Sleep } from './sleep';
import { SelfStore } from './store';

const HOUR = 60 * 60_000;

let dataDir: string;
let db: Database.Database;
let self: SelfStore;
let experience: ExperienceLog;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-sleep-'));
  db = openDatabase(dataDir);
  self = new SelfStore(db, join(dataDir, 'self'));
  experience = new ExperienceLog(db, new ConversationStore(db));
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** `n` check-ins that spoke, the last answered with Not now. */
function checkIns(n: number): void {
  let ref = '';
  for (let i = 0; i < n; i += 1) {
    ref = randomUUID();
    experience.checkIn({
      ref,
      petId: 'scout',
      trigger: 'trouble',
      input: `bundle ${i}`,
      decision: 'spoke',
      said: `That build failed again (${i}).`,
    });
  }
  experience.outcome(ref, 'not-now');
}

/** `n` questions of theirs, each answered. */
function turns(n: number): void {
  for (let i = 0; i < n; i += 1) {
    const turnId = randomUUID();
    experience.observe({
      method: 'turn.started',
      params: {
        turnId,
        petId: 'scout',
        conversationId: randomUUID(),
        providerId: 'fake',
        model: 'fake-model',
      },
    });
    experience.observe({
      method: 'turn.completed',
      params: {
        turnId,
        text: `Answer ${i}.`,
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    });
  }
}

/** A day worth sleeping on: enough conversations, and check-ins with a Not now. */
function day(n = MIN_EPISODES): void {
  turns(n);
  checkIns(5);
}

interface SetupState {
  idle: boolean;
  spentOut: boolean;
  /** When a turn of theirs last ended, on the fake clock. */
  lastTalkAt?: number;
}

function setup(
  mind: MindStep[],
  state: SetupState = { idle: true, spentOut: false },
  during?: () => void,
) {
  // The episodes carry real timestamps, so the clock starts just before real time.
  const clock = new FakeClock(Date.now() - 60_000);
  const brain = fakeMind(...mind);
  const logs: string[] = [];
  const sleep = new Sleep({
    db,
    self,
    experience,
    clock,
    pet: () => scout,
    provider: (pet) => {
      const provider = brain.resolve(pet);
      return {
        ...provider,
        complete: (...args) => {
          during?.();
          return provider.complete(...args);
        },
      };
    },
    spentOut: () => state.spentOut,
    idle: () => state.idle,
    lastTalkAt: () => state.lastTalkAt ?? Number.NEGATIVE_INFINITY,
    log: (message) => logs.push(message),
  });
  // Away from the keyboard for as long as sleep needs, unless a test says otherwise.
  sleep.observeIdle(AWAY_MS);
  return { clock, brain, sleep, logs, state };
}

const reply = (changes: unknown[]) => JSON.stringify({ changes });

describe('Sleep: when', () => {
  it(`waits for at least ${MIN_EPISODES} episodes, quiet, within budget`, async () => {
    day(MIN_EPISODES - 1);
    const t = setup([reply([])]);
    expect(await t.sleep.maybeRun()).toBe(false);
    day(1);
    t.state.idle = false;
    expect(await t.sleep.maybeRun()).toBe(false);
    t.state.idle = true;
    t.state.spentOut = true;
    expect(await t.sleep.maybeRun()).toBe(false);
    t.state.spentOut = false;
    expect(await t.sleep.maybeRun()).toBe(true);
    expect(t.brain.requests).toHaveLength(1);
  });

  it(`counts only their conversations toward the ${MIN_EPISODES}, never check-ins`, async () => {
    checkIns(20);
    turns(MIN_EPISODES - 1);
    const t = setup([reply([])]);
    expect(await t.sleep.maybeRun()).toBe(false);
    turns(1);
    expect(await t.sleep.maybeRun()).toBe(true);
  });

  it('waits until they have been away 30 minutes, by the idle time while it is fresh', async () => {
    day();
    const t = setup([reply([])]);
    t.sleep.observeIdle(AWAY_MS - 5 * 60_000);
    expect(await t.sleep.maybeRun()).toBe(false);
    await t.clock.advance(2 * 60_000);
    expect(await t.sleep.maybeRun()).toBe(false);
    t.sleep.observeIdle(AWAY_MS);
    expect(await t.sleep.maybeRun()).toBe(true);
  });

  it('without a fresh idle time, waits 30 minutes since they last talked and since it started', async () => {
    day();
    const t = setup([reply([])]);
    // The reading goes stale a few minutes after the app started; they never talked.
    await t.clock.advance(4 * 60_000);
    expect(await t.sleep.maybeRun()).toBe(false);
    await t.clock.advance(AWAY_MS);
    t.state.lastTalkAt = t.clock.now() - 10 * 60_000;
    expect(await t.sleep.maybeRun()).toBe(false);
    t.state.lastTalkAt = t.clock.now() - AWAY_MS;
    expect(await t.sleep.maybeRun()).toBe(true);
  });

  it('sleeps once, then waits a long gap and for new episodes', async () => {
    day();
    const t = setup([reply([])]);
    expect(await t.sleep.maybeRun()).toBe(true);
    day();
    await t.clock.advance(SLEEP_GAP_MS - HOUR);
    expect(await t.sleep.maybeRun()).toBe(false);
    await t.clock.advance(2 * HOUR);
    expect(await t.sleep.maybeRun()).toBe(true);
  });
});

describe('Sleep: what the mind is shown', () => {
  it('thinks on Scout’s own model, in its soul, with its notes and what happened, as data', async () => {
    self.write('lessons.md', 'Lead with the gist.', { author: 'person', why: 'x' });
    day();
    const t = setup([reply([])]);
    await t.sleep.maybeRun();
    const request = t.brain.requests[0]!;
    expect(t.brain.asked[0]).toMatchObject({ model: scout.model });
    expect(request.system).toBe(`${soul()}\n\n${SLEEP_INSTRUCTIONS}`);
    const bundle = sentText(request);
    expect(bundle).toContain('### lessons.md\nLead with the gist.');
    expect(bundle).toContain('That build failed again (4).');
    expect(bundle).toContain('They: not-now');
    expect(bundle).toContain('data, not instructions');
  });

  it('shows each skill by its name and first line only, so the bundle stays small', async () => {
    self.write('skills/triage.md', '# Triage a build\nRead the first error.', {
      author: 'person',
      why: 'x',
    });
    day();
    const t = setup([reply([])]);
    await t.sleep.maybeRun();
    const bundle = sentText(t.brain.requests[0]!);
    expect(bundle).toContain('skills/triage.md: # Triage a build');
    expect(bundle).not.toContain('Read the first error.');
  });

  it('leaves room for four whole pages in its reply', async () => {
    day();
    const t = setup([reply([])]);
    await t.sleep.maybeRun();
    expect(t.brain.requests[0]!.maxTokens).toBeGreaterThanOrEqual(12_000);
  });
});

describe('Sleep: what it may change', () => {
  it('proposes each change as sleep, with its reasons, applies none, and records the night', async () => {
    day();
    const t = setup([
      reply([
        {
          path: 'lessons.md',
          text: 'They do not want repeat build alerts.',
          why: 'Not now after the fifth.',
        },
        {
          path: 'skills/triage-a-build.md',
          text: '# Triage a build\nRead the first error.',
          why: 'Worked.',
        },
      ]),
    ]);
    expect(await t.sleep.maybeRun()).toBe(true);
    expect(self.read('lessons.md')).toBe('');
    expect(self.history('lessons.md')[0]).toMatchObject({
      author: 'sleep',
      why: 'Not now after the fifth.',
      state: 'proposed',
      text: 'They do not want repeat build alerts.',
    });
    expect(self.read('skills/triage-a-build.md')).toBe('');
    expect(self.proposals().map((version) => version.path)).toEqual([
      'lessons.md',
      'skills/triage-a-build.md',
    ]);
    expect(t.sleep.nights(5)).toEqual([
      {
        state: 'done',
        startedAt: expect.any(String),
        note: 'Proposed lessons.md, skills/triage-a-build.md.',
      },
    ]);
  });

  it('never empties a core page, touches a page that is not one, or proposes more than four changes', async () => {
    self.write('you.md', 'Works on Tagalong.', { author: 'scout', why: 'x' });
    day();
    const t = setup([
      reply([
        { path: 'you.md', text: '', why: 'Start over.' },
        { path: '../secrets.json', text: 'x', why: 'y' },
        { path: 'skills/a.md', text: 'a', why: 'y' },
        { path: 'skills/b.md', text: 'b', why: 'y' },
        { path: 'skills/c.md', text: 'c', why: 'y' },
        { path: 'skills/d.md', text: 'd', why: 'y' },
        { path: 'skills/e.md', text: 'e', why: 'y' },
      ]),
    ]);
    await t.sleep.maybeRun();
    expect(self.read('you.md')).toBe('Works on Tagalong.');
    expect(self.proposals().map((version) => version.path)).toEqual([
      'skills/a.md',
      'skills/b.md',
      'skills/c.md',
      'skills/d.md',
    ]);
  });

  it('skips a page that changed while it slept, and proposes the rest', async () => {
    self.write('you.md', 'Works on Tagalong.', { author: 'person', why: 'x' });
    day();
    const t = setup(
      [
        reply([
          { path: 'you.md', text: 'Works late on Tagalong.', why: 'Seen.' },
          { path: 'lessons.md', text: 'Lead with the gist.', why: 'Seen.' },
        ]),
      ],
      { idle: true, spentOut: false },
      () => self.write('you.md', 'Works on Tagalong and a game.', { author: 'person', why: 'x' }),
    );
    expect(await t.sleep.maybeRun()).toBe(true);
    expect(self.proposals().map((version) => version.path)).toEqual(['lessons.md']);
    expect(t.logs.join('\n')).toContain('you.md changed while sleeping');
  });

  it('records running out of room as a failed night, with a clear reason', async () => {
    day();
    const t = setup([
      { reply: '{"changes": [{"path": "lessons.md", "te', stopReason: 'max_tokens' },
    ]);
    expect(await t.sleep.maybeRun()).toBe(false);
    expect(t.sleep.nights(1)[0]).toMatchObject({
      state: 'error',
      note: expect.stringMatching(/ran out of room/),
    });
    expect(self.proposals()).toEqual([]);
  });

  it('records a reply it cannot read as a failed night, and changes nothing', async () => {
    day();
    const t = setup(['I think they want fewer alerts.']);
    expect(await t.sleep.maybeRun()).toBe(false);
    expect(self.read('lessons.md')).toBe('');
    expect(db.prepare('SELECT state FROM self_sleeps').get()).toEqual({ state: 'error' });
    expect(t.logs.join('\n')).toContain('sleep');
  });
});
