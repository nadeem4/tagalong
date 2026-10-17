/** Tests for the memory digest: when it runs, what it sends, and how its reply is checked. */
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { fakeMind, scout, sentText, type MindStep } from '../check-in/test-support';
import { JobStore } from '../jobs/store';
import { soul } from '../roles';
import { FakeClock } from '../watch/fake-clock';
import { migrate } from './db';
import {
  DIGEST_INSTRUCTIONS,
  Digest,
  FIRST_CHECK_MS,
  CHECK_EVERY_MS,
  SUMMARY_CAP,
  parseDigest,
} from './digest';
import { MemoryStore } from './memories';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const KEY = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

interface SetupOptions {
  mind?: MindStep[];
  summarizer?: { providerId: string; model: string } | null;
}

function setup(options: SetupOptions = {}) {
  const db = new Database(':memory:');
  migrate(db);
  const memories = new MemoryStore(db);
  const jobs = new JobStore(db);
  // Noon local time, so a day's two attempts never straddle midnight in a test.
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const clock = new FakeClock(start.getTime());
  const mind = fakeMind(...(options.mind ?? ['NOTHING']));
  const state = { pet: scout as typeof scout | null, spentOut: false, idle: true, pruned: 0 };
  const answers = new Map<string, string>();
  const logs: string[] = [];
  const digest = new Digest({
    memories,
    jobs,
    clock,
    pet: () => state.pet,
    summarizer: () => options.summarizer ?? null,
    provider: mind.resolve,
    spentOut: () => state.spentOut,
    idle: () => state.idle,
    pruneJobs: () => {
      state.pruned += 1;
    },
    lastAnswer: (conversationId) => answers.get(conversationId) ?? null,
    log: (message) => logs.push(message),
    timeoutMs: 50,
  });
  let jobCount = 0;
  /** A job that finished well, with its full answer in its conversation. */
  const doneJob = (task: string, note: string, answer = note) => {
    jobCount += 1;
    const id = `${jobCount}b2c0000-0000-4000-8000-00000000000${jobCount}`;
    const at = new Date(clock.now()).toISOString();
    jobs.insert({ id, petId: 'scout', task, dedupeKey: task, at });
    jobs.start(id, `conv-${id}`, at);
    jobs.finish(id, { state: 'done', note }, at);
    answers.set(`conv-${id}`, answer);
    return id;
  };
  /** Moves a memory's date back, as if saved `days` ago. */
  const age = (id: string, days: number) => {
    const at = new Date(clock.now() - days * DAY).toISOString();
    db.prepare('UPDATE memories SET created_at = ? WHERE id = ?').run(at, id);
  };
  const short = (id: string) => `m-${id.slice(0, 8)}`;
  return { db, memories, jobs, clock, mind, state, digest, doneJob, age, short, logs };
}

describe('parseDigest', () => {
  it('reads ADD, REPLACE and DROP lines in any order and ignores the rest', () => {
    expect(
      parseDigest(
        [
          'DROP m-1111aaaa',
          'Some thinking out loud.',
          '- ADD preference: Short answers in the morning.',
          'REPLACE m-2222bbbb: Works on Tagalong, a desktop companion.',
          'add fact: Uses pnpm.',
          'ADD feeling: not a kind',
          'REPLACE m-3333: ',
        ].join('\n'),
      ),
    ).toEqual({
      add: [
        { kind: 'preference', text: 'Short answers in the morning.' },
        { kind: 'fact', text: 'Uses pnpm.' },
      ],
      replace: [{ id: 'm-2222bbbb', text: 'Works on Tagalong, a desktop companion.' }],
      drop: ['m-1111aaaa'],
    });
  });

  it('reads NOTHING as no change, and caps each kind of line at ten', () => {
    expect(parseDigest('NOTHING')).toEqual({ add: [], replace: [], drop: [] });
    const many = Array.from({ length: 12 }, (_, i) => `ADD fact: f${i}\nDROP m-${i}`).join('\n');
    const ops = parseDigest(many);
    expect(ops.add).toHaveLength(10);
    expect(ops.drop).toHaveLength(10);
  });
});

describe('Digest: when it runs', () => {
  it('runs when idle with something new, and records a digest row that ends done', async () => {
    const t = setup();
    t.doneJob('summarise the launch thread', 'Friday it is.');

    expect(await t.digest.maybeRun()).toBe(true);

    expect(t.mind.requests).toHaveLength(1);
    const [row] = t.jobs.digests('');
    expect(row).toMatchObject({ kind: 'digest', state: 'done', task: 'Tidy memory' });
    expect(row?.note).toBe('Added 0, changed 0, let 0 go.');
    expect(t.jobs.undigested(10)).toEqual([]);
  });

  it('does not run with no pet, a spent budget, a turn or job going, or nothing new', async () => {
    const t = setup();
    expect(await t.digest.maybeRun()).toBe(false);
    t.doneJob('read the paper', 'Long.');
    t.state.pet = null;
    expect(await t.digest.maybeRun()).toBe(false);
    t.state.pet = scout;
    t.state.spentOut = true;
    expect(await t.digest.maybeRun()).toBe(false);
    t.state.spentOut = false;
    t.state.idle = false;
    expect(await t.digest.maybeRun()).toBe(false);
    expect(t.mind.requests).toHaveLength(0);
  });

  it('three new summaries are enough to run, two are not', async () => {
    const t = setup();
    t.memories.add({ petId: 'scout', kind: 'summary', text: 'One.' });
    t.memories.add({ petId: 'scout', kind: 'summary', text: 'Two.' });
    expect(await t.digest.maybeRun()).toBe(false);
    t.memories.add({ petId: 'scout', kind: 'summary', text: 'Three.' });
    expect(await t.digest.maybeRun()).toBe(true);
  });

  it('waits 20 hours after a digest that worked', async () => {
    const t = setup();
    t.doneJob('read the paper', 'Long.');
    await t.digest.maybeRun();
    t.doneJob('read the other paper', 'Short.');

    await t.clock.sleep(19 * HOUR);
    expect(await t.digest.maybeRun()).toBe(false);
    await t.clock.sleep(HOUR);
    expect(await t.digest.maybeRun()).toBe(true);
  });

  it('a failure changes nothing and is retried once the same day, not twice', async () => {
    const t = setup({ mind: [{ throws: new Error('overloaded') }] });
    const kept = t.memories.add({ petId: 'scout', kind: 'fact', text: 'Uses pnpm.' });
    t.doneJob('read the paper', 'Long.');

    expect(await t.digest.maybeRun()).toBe(false);
    expect(t.jobs.digests('')[0]).toMatchObject({ state: 'error', error: 'overloaded' });
    expect(t.memories.recent('scout', 10)).toEqual([kept]);
    expect(t.jobs.undigested(10)).toHaveLength(1);
    expect(t.state.pruned).toBe(0);

    await t.clock.sleep(30 * 60_000);
    expect(await t.digest.maybeRun()).toBe(false);
    await t.clock.sleep(30 * 60_000);
    expect(await t.digest.maybeRun()).toBe(false);
    expect(t.mind.requests).toHaveLength(2);
    expect(t.logs.join('\n')).toContain('overloaded');
  });

  it('a mind that does not answer in time is a failure too', async () => {
    const t = setup({ mind: ['hang'] });
    t.doneJob('read the paper', 'Long.');
    expect(await t.digest.maybeRun()).toBe(false);
    expect(t.jobs.digests('')[0]?.state).toBe('error');
  });

  it('checks five minutes after start, then every thirty minutes, until stopped', async () => {
    const t = setup();
    t.digest.start();
    t.doneJob('read the paper', 'Long.');
    await t.clock.advance(FIRST_CHECK_MS - 1);
    expect(t.mind.requests).toHaveLength(0);
    await t.clock.advance(1);
    expect(t.mind.requests).toHaveLength(1);

    // Material again, but the 20 hours hold it back; the timer keeps checking.
    t.memories.add({ petId: 'scout', kind: 'summary', text: 'One.' });
    await t.clock.advance(CHECK_EVERY_MS);
    expect(t.mind.requests).toHaveLength(1);
    expect(t.clock.pendingTimers).toBe(1);
    t.digest.stop();
    expect(t.clock.pendingTimers).toBe(0);
  });
});

describe('Digest: what it sends', () => {
  it('sends the soul and the tidying block as a stable system prompt, on the summaries model', async () => {
    const t = setup({ summarizer: { providerId: 'ollama', model: 'small' } });
    t.doneJob('read the paper', 'Long.');
    await t.digest.maybeRun();
    t.doneJob('read the other paper', 'Short.');
    await t.clock.sleep(DAY);
    await t.digest.maybeRun();

    expect(t.mind.requests).toHaveLength(2);
    for (const request of t.mind.requests) {
      expect(request.system).toBe(`${soul()}\n\n${DIGEST_INSTRUCTIONS}`);
      expect(request.model).toBe('small');
      expect(request.tools ?? []).toEqual([]);
    }
    expect(t.mind.asked[0]).toMatchObject({ providerId: 'ollama', model: 'small' });
  });

  it('lists memories with ids, old and new summaries and the recent work, secrets hidden', async () => {
    const t = setup();
    const pref = t.memories.add({ petId: 'scout', kind: 'preference', text: 'Short answers.' });
    t.memories.add({ petId: 'ink', kind: 'fact', text: 'Not Scout’s.' });
    const old = t.memories.add({ petId: 'scout', kind: 'summary', text: 'An old chat.' });
    t.age(old.id, 40);
    const fresh = t.memories.add({ petId: 'scout', kind: 'summary', text: 'A chat today.' });
    t.doneJob('summarise the launch thread', 'Friday it is.', `Friday it is.\nkey ${KEY}`);

    await t.digest.maybeRun();
    const sent = sentText(t.mind.requests[0]!);

    expect(sent).toContain(
      `## What you remember now\n- ${t.short(pref.id)} (preference) Short answers.`,
    );
    expect(sent).not.toContain('Not Scout’s.');
    expect(sent).toContain('## Older summaries (30+ days)');
    expect(sent).toContain(`- ${t.short(old.id)} (summary,`);
    expect(sent).toContain('## Recent conversation summaries');
    expect(sent).toContain(`- ${t.short(fresh.id)} (summary, today) A chat today.`);
    expect(sent).toContain('## Recent work');
    expect(sent).toContain('"summarise the launch thread" (done, today): Friday it is.');
    expect(sent).toContain('~~~text\nFriday it is.');
    expect(sent).not.toContain(KEY);
  });
});

describe('Digest: applying the reply', () => {
  it('adds, changes and lets go, within the rules, and says how many in its note', async () => {
    const t = setup();
    const pref = t.memories.add({ petId: 'scout', kind: 'preference', text: 'Short answers.' });
    const fact = t.memories.add({ petId: 'scout', kind: 'fact', text: 'Works on a repo.' });
    const stale = t.memories.add({ petId: 'scout', kind: 'fact', text: 'Has a cold.' });
    const theirs = t.memories.add({ petId: 'ink', kind: 'fact', text: 'Ink’s.' });
    t.doneJob('read the paper', 'Long.');
    const reply = [
      `ADD fact: Their API key is ${KEY}`,
      `ADD preference: ${'p'.repeat(400)}`,
      `REPLACE ${t.short(fact.id)}: Works on Tagalong.`,
      `DROP ${t.short(stale.id)}`,
      `DROP ${t.short(pref.id)}`,
      `DROP m-${theirs.id.slice(0, 8)}`,
      'DROP m-zzzzzzzz',
      'REPLACE m-zzzzzzzz: Nothing.',
    ].join('\n');
    // The reply names the ids just made, so this digest's mind is built after them.
    const digest = new Digest({
      memories: t.memories,
      jobs: t.jobs,
      clock: t.clock,
      pet: () => scout,
      summarizer: () => null,
      provider: fakeMind(reply).resolve,
      spentOut: () => false,
      idle: () => true,
      pruneJobs: () => undefined,
      lastAnswer: () => null,
    });

    expect(await digest.maybeRun()).toBe(true);

    const texts = t.memories.recent('scout', 20).map((m) => m.text);
    expect(texts).toContain('Short answers.');
    expect(texts).toContain('Works on Tagalong.');
    expect(texts).not.toContain('Has a cold.');
    expect(texts.join('\n')).not.toContain(KEY);
    const long = t.memories.recent('scout', 20, ['preference']).find((m) => m.text.startsWith('p'));
    expect(long?.text.length).toBeLessThanOrEqual(300);
    expect(t.memories.recent('ink', 5)).toHaveLength(1);
    expect(t.jobs.digests('')[0]?.note).toBe('Added 2, changed 1, let 1 go.');
  });

  it('counts only the memories an ADD really saved, not one it already had', async () => {
    const t = setup({ mind: ['ADD fact: Works on a repo.\nADD fact: Uses pnpm.'] });
    t.memories.add({ petId: 'scout', kind: 'fact', text: 'Works on a repo.' });
    t.doneJob('read the paper', 'Long.');

    expect(await t.digest.maybeRun()).toBe(true);

    expect(t.memories.count('scout', 'fact')).toBe(2);
    expect(t.jobs.digests('')[0]?.note).toBe('Added 1, changed 0, let 0 go.');
  });

  it('prunes old jobs and keeps at most 200 summaries, oldest going first', async () => {
    const t = setup();
    const first = t.memories.add({ petId: 'scout', kind: 'summary', text: 'The very first.' });
    t.age(first.id, 300);
    for (let i = 0; i < SUMMARY_CAP; i += 1) {
      t.memories.add({ petId: 'scout', kind: 'summary', text: `s${i}` });
    }

    expect(await t.digest.maybeRun()).toBe(true);

    expect(t.state.pruned).toBe(1);
    expect(t.memories.count('scout', 'summary')).toBe(SUMMARY_CAP);
    expect(t.memories.recent('scout', 300, ['summary']).map((m) => m.text)).not.toContain(
      'The very first.',
    );
  });
});
