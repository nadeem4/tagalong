/** Tests for ActivityLog: every row kind, older kinds, paging and the greeting and briefing reads. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ACTIVITY_TEXT_CHARS, ActivityLog } from './activity';
import { openDatabase } from './db';
import { ConversationStore } from './store';

let dataDir: string;
let db: Database.Database;
let store: ConversationStore;
let log: ActivityLog;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-activity-'));
  db = openDatabase(dataDir);
  store = new ConversationStore(db);
  log = new ActivityLog(db, store);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** A conversation whose last message is the user's question, as the runner leaves it. */
function asked(petId: string, text: string): string {
  const conversation = store.createConversation({ petId });
  store.appendMessage({
    conversationId: conversation.id,
    role: 'user',
    content: [{ type: 'text', text }],
  });
  return conversation.id;
}

function started(petId: string, conversationId: string): string {
  const turnId = randomUUID();
  log.observe({
    method: 'turn.started',
    params: { turnId, petId, conversationId, providerId: 'fake', model: 'fake-model' },
  });
  return turnId;
}

function completed(turnId: string, text: string, modelCalls = 1): void {
  log.observe({
    method: 'turn.completed',
    params: {
      turnId,
      text,
      stopReason: 'end',
      usage: { inputTokens: 1, outputTokens: 1 },
      modelCalls,
    },
  });
}

describe('ActivityLog: turns', () => {
  it('records a turn from start to finish: pet, model, question, answer and calls', () => {
    const conversationId = asked('scout', 'what is this error?');
    const turnId = started('scout', conversationId);
    expect(log.list({}).entries[0]).toMatchObject({
      kind: 'turn',
      state: 'running',
      petId: 'scout',
      turnId,
      conversationId,
      providerId: 'fake',
      model: 'fake-model',
      text: 'what is this error?',
    });

    completed(turnId, 'A missing semicolon.', 3);
    const [entry] = log.list({}).entries;
    expect(entry).toMatchObject({ state: 'done', answer: 'A missing semicolon.', modelCalls: 3 });
    expect(entry?.finishedAt).toBeDefined();
  });

  it('records a failed turn with its reason, and an interrupted one as stopped', () => {
    const failed = started('scout', asked('scout', 'one'));
    log.observe({
      method: 'turn.error',
      params: { turnId: failed, code: 'auth', message: 'no key' },
    });
    const stopped = started('ink', asked('ink', 'two'));
    log.observe({
      method: 'turn.completed',
      params: {
        turnId: stopped,
        text: '',
        stopReason: 'aborted',
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    });
    const [second, first] = log.list({}).entries;
    expect(first).toMatchObject({ state: 'error', error: 'no key' });
    expect(second).toMatchObject({ state: 'stopped' });
  });

  it('ignores what it does not record: deltas, warnings, unknown turns', () => {
    log.observe({ method: 'turn.delta', params: { turnId: randomUUID(), text: 'x' } });
    completed(randomUUID(), 'nobody started me');
    expect(log.list({}).entries).toEqual([]);
  });

  it('survives a restart: the record is in the database', () => {
    completed(started('scout', asked('scout', 'kept?')), 'yes');
    const again = new ActivityLog(db, store);
    expect(again.list({}).entries).toHaveLength(1);
  });
});

describe('ActivityLog: a job’s turn', () => {
  it('writes no turn row for a job’s background turn: the jobs row is its record', () => {
    const turnId = randomUUID();
    log.observe({
      method: 'turn.started',
      params: {
        turnId,
        petId: 'scout',
        conversationId: asked('scout', 'brief'),
        background: true,
        jobId: randomUUID(),
      },
    });
    completed(turnId, 'gist');
    expect(log.list({}).entries).toEqual([]);
    expect(log.lastTurnAt('scout')).toBeNull();
  });
});

describe('ActivityLog.entry, for open_result', () => {
  it('reads one finished expert or routine row by id, and nothing else', () => {
    const id = log.expertStarted({ petId: 'scout', expertId: 'e', expertName: 'E', text: 'ask' });
    log.expertFinished(id, { ok: true, text: 'The answer.', changedFiles: [] });
    expect(log.entry(id)).toMatchObject({ kind: 'expert', answer: 'The answer.' });
    started('scout', asked('scout', 'hi'));
    const turn = log.list({}).entries.find((row) => row.kind === 'turn')!;
    expect(log.entry(turn.id)).toBeNull();
    expect(log.entry('nope')).toBeNull();
  });
});

describe('ActivityLog.lastTurnAt, for the Now block', () => {
  it('is null before this pet has had a turn', () => {
    expect(log.lastTurnAt('scout')).toBeNull();
  });

  it("is when this pet's latest turn started, whatever happened to it", () => {
    started('scout', asked('scout', 'first'));
    const firstAt = log.list({}).entries[0]?.startedAt;
    db.prepare(`UPDATE activity SET started_at = '2020-01-01T00:00:00.000Z'`).run();
    const second = started('scout', asked('scout', 'second'));
    completed(second, 'answered');
    const secondAt = log.list({}).entries.find((entry) => entry.text === 'second')?.startedAt;
    expect(firstAt).toBeDefined();
    expect(log.lastTurnAt('scout')).toBe(secondAt);
  });

  it("counts only turns, and only this pet's", () => {
    started('other', asked('other', 'not Scout'));
    log.expertStarted({ petId: 'scout', expertId: 'cc', expertName: 'Claude Code', text: 'x' });
    expect(log.lastTurnAt('scout')).toBeNull();
  });
});

describe('ActivityLog.lastExchange, for check-ins', () => {
  it('is null before this pet has answered anything', () => {
    expect(log.lastExchange('scout')).toBeNull();
    started('scout', asked('scout', 'still running'));
    expect(log.lastExchange('scout')).toBeNull();
  });

  it("is this pet's latest answered question and its answer", () => {
    completed(started('scout', asked('scout', 'first')), 'one');
    db.prepare(`UPDATE activity SET started_at = '2020-01-01T00:00:00.000Z'`).run();
    completed(started('scout', asked('scout', 'second')), 'two');
    completed(started('other', asked('other', 'not Scout')), 'no');
    expect(log.lastExchange('scout')).toEqual({ said: 'second', answered: 'two' });
  });
});

describe('ActivityLog.expertEntry, for a finished hand-off', () => {
  it('names the expert and what it was asked, by hand-off id', () => {
    const id = log.expertStarted({
      petId: 'scout',
      expertId: 'cc',
      expertName: 'Claude Code',
      text: 'fix the login test',
    });
    expect(log.expertEntry(id)).toEqual({ expertName: 'Claude Code', ask: 'fix the login test' });
    expect(log.expertEntry(randomUUID())).toBeNull();
  });
});

describe('ActivityLog: crew-era rows', () => {
  it('leaves consults, handoffs and roundtables a crew-era install recorded out of the list', () => {
    const add = db.prepare(
      `INSERT INTO activity (id, kind, state, pet_id, to_pet_id, run_id, text, started_at)
       VALUES (?, ?, 'done', 'scout', ?, ?, 'old', ?)`,
    );
    add.run('c1', 'consult', 'ink', null, '2026-09-01T00:00:00.000Z');
    add.run('h1', 'handoff', 'bolt', null, '2026-09-01T00:00:01.000Z');
    add.run('r1', 'roundtable', null, randomUUID(), '2026-09-01T00:00:02.000Z');
    const turnId = started('scout', asked('scout', 'still here?'));

    const { entries, next } = log.list({});

    expect(entries.map((entry) => entry.turnId)).toEqual([turnId]);
    expect(next).toBeUndefined();
  });
});

describe('ActivityLog.list', () => {
  it('pages newest first, with a cursor while older entries remain', () => {
    const turns = ['one', 'two', 'three'].map((text) => started('scout', asked('scout', text)));
    const page = log.list({ limit: 2 });
    expect(page.entries.map((entry) => entry.turnId)).toEqual([turns[2], turns[1]]);
    expect(page.next).toBeDefined();
    const rest = log.list({ limit: 2, before: page.next });
    expect(rest.entries.map((entry) => entry.turnId)).toEqual([turns[0]]);
    expect(rest.next).toBeUndefined();
  });

  it('clips very long text so a pasted file does not fill the table', () => {
    const turnId = started('scout', asked('scout', 'x'.repeat(10_000)));
    completed(turnId, 'y'.repeat(10_000));
    const [entry] = log.list({}).entries;
    expect(entry?.text?.length).toBeLessThanOrEqual(4_000);
    expect(entry?.answer?.length).toBeLessThanOrEqual(4_000);
  });
});

describe('expert hand-offs', () => {
  it('rewrites what the expert was told when a note is passed on, clipped like any text', () => {
    const id = log.expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix it',
    });
    log.expertBriefed(id, 'Fix it\n\nPassed on while it worked:\n- use dayjs');
    expect(log.list({}).entries[0]?.text).toBe('Fix it\n\nPassed on while it worked:\n- use dayjs');
    log.expertBriefed(id, 'x'.repeat(ACTIVITY_TEXT_CHARS + 10));
    expect(log.list({}).entries[0]?.text).toHaveLength(ACTIVITY_TEXT_CHARS);
  });

  it('records the brief, then the answer and the files changed', () => {
    const id = log.expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix the failing test',
    });
    expect(log.list({}).entries[0]).toMatchObject({
      id,
      kind: 'expert',
      state: 'running',
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix the failing test',
    });

    log.expertFinished(id, { ok: true, text: 'Fixed.', changedFiles: ['a.ts'] });
    expect(log.list({}).entries[0]).toMatchObject({
      state: 'done',
      answer: 'Fixed.',
      changedFiles: ['a.ts'],
      finishedAt: expect.any(String) as string,
    });
  });

  it('records why a hand-off failed, and a cancel as stopped', () => {
    const failed = log.expertStarted({ petId: 'scout', expertId: 'x', expertName: 'X', text: 'a' });
    log.expertFinished(failed, { ok: false, error: 'not signed in' });
    const stopped = log.expertStarted({
      petId: 'scout',
      expertId: 'x',
      expertName: 'X',
      text: 'b',
    });
    log.expertFinished(stopped, { ok: false, error: 'Cancelled.' }, 'stopped');

    const [second, first] = log.list({}).entries;
    expect(first).toMatchObject({ state: 'error', error: 'not signed in' });
    expect(second?.state).toBe('stopped');
    expect(second?.error).toBeUndefined();
  });

  it('lists the hand-offs that finished well since a time, for the greeting', () => {
    const before = new Date(Date.now() - 60_000).toISOString();
    const done = log.expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix the failing test',
    });
    log.expertFinished(done, { ok: true, text: 'Fixed.', changedFiles: [] });
    const failed = log.expertStarted({ petId: 'scout', expertId: 'x', expertName: 'X', text: 'a' });
    log.expertFinished(failed, { ok: false, error: 'not signed in' });
    log.expertStarted({ petId: 'scout', expertId: 'x', expertName: 'X', text: 'still going' });

    expect(log.expertsFinishedSince(before)).toEqual([
      { expertName: 'Claude Code', text: 'Fix the failing test' },
    ]);
    expect(log.expertsFinishedSince(new Date(Date.now() + 60_000).toISOString())).toEqual([]);
  });
});

describe('hand-offs left half done, for a pick-up', () => {
  it('lists the ones that stopped or failed since a time, by expert and ask alone', () => {
    const before = new Date(Date.now() - 60_000).toISOString();
    const stopped = log.expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix the e2e tests\n\nSelected text:\ntoken=abc',
    });
    log.expertFinished(stopped, { ok: false, error: 'stopped' }, 'stopped');
    const failed = log.expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Write the docs',
    });
    log.expertFinished(failed, { ok: false, error: 'not signed in' });
    const done = log.expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Done one',
    });
    log.expertFinished(done, { ok: true, text: 'ok', changedFiles: [] });

    expect(log.expertsLeftSince(before)).toEqual([
      {
        expertId: 'claude-code',
        expertName: 'Claude Code',
        ask: 'Fix the e2e tests',
        state: 'stopped',
      },
      { expertId: 'claude-code', expertName: 'Claude Code', ask: 'Write the docs', state: 'error' },
    ]);
    expect(log.expertsLeftSince(new Date(Date.now() + 60_000).toISOString())).toEqual([]);
  });
});

describe('routines for the greeting', () => {
  it('lists the routines that ran well since a time, by name, for the greeting', () => {
    const before = new Date(Date.now() - 60_000).toISOString();
    const routineId = randomUUID();
    const done = log.routineStarted({ routineId, petId: 'scout', name: 'Morning papers' });
    log.routineFinished(done, { state: 'done', answer: 'Three new papers.' });
    const failed = log.routineStarted({ routineId, petId: 'scout', name: 'Inbox sweep' });
    log.routineFinished(failed, { state: 'error', error: 'No key for Scout.' });
    log.routineStarted({ routineId, petId: 'scout', name: 'Still running' });

    expect(log.routinesFinishedSince(before)).toEqual(['Morning papers']);
    expect(log.routinesFinishedSince(new Date(Date.now() + 60_000).toISOString())).toEqual([]);
  });
});

describe('connector calls', () => {
  it('records the app, the tool, read or write, and how it ended, never the content', () => {
    log.connectorCalled({
      petId: 'scout',
      turnId: randomUUID(),
      app: 'Notion',
      tool: 'search',
      access: 'read',
      state: 'done',
    });
    log.connectorCalled({
      petId: 'scout',
      app: 'Notion',
      tool: 'create-pages',
      access: 'write',
      state: 'error',
      error: 'Notion did not answer within 30 seconds.',
    });
    log.connectorCalled({
      petId: 'scout',
      app: 'Notion',
      tool: 'create-pages',
      access: 'write',
      state: 'stopped',
    });
    const [stopped, failed, done] = log.list({}).entries;
    expect(done).toMatchObject({
      kind: 'connector',
      app: 'Notion',
      tool: 'search',
      access: 'read',
    });
    expect(done?.state).toBe('done');
    expect(done?.finishedAt).toBeDefined();
    expect(failed).toMatchObject({
      state: 'error',
      error: 'Notion did not answer within 30 seconds.',
    });
    expect(stopped?.state).toBe('stopped');
    expect(done?.text).toBeUndefined();
    expect(done?.answer).toBeUndefined();
  });

  it('records a routine run: its name, how it ended, and the answer in Scout’s conversation', () => {
    const routineId = randomUUID();
    const conversationId = randomUUID();
    const done = log.routineStarted({ routineId, petId: 'scout', name: 'Morning papers' });
    log.routineFinished(done, { state: 'done', answer: 'Three new papers.', conversationId });
    const failed = log.routineStarted({ routineId, petId: 'scout', name: 'Morning papers' });
    log.routineFinished(failed, { state: 'error', error: 'No key for Scout.' });

    const [second, first] = log.list({}).entries;
    expect(first).toMatchObject({
      id: done,
      kind: 'routine',
      state: 'done',
      routineId,
      text: 'Morning papers',
      answer: 'Three new papers.',
      conversationId,
    });
    expect(first?.finishedAt).toBeDefined();
    expect(second).toMatchObject({ kind: 'routine', state: 'error', error: 'No key for Scout.' });
  });
});

describe('after a crash', () => {
  it('marks every row still running as interrupted, and leaves finished rows alone', () => {
    const turnId = started('scout', asked('scout', 'hi'));
    const expert = log.expertStarted({
      petId: 'scout',
      expertId: 'claude-code',
      expertName: 'Claude Code',
      text: 'Fix the test.',
    });
    const routine = log.routineStarted({ routineId: randomUUID(), petId: 'scout', name: 'Papers' });
    log.routineFinished(routine, { state: 'done', answer: 'None today.' });

    expect(log.interrupted()).toBe(2);

    const entries = log.list({}).entries;
    const byId = (id: string) => entries.find((entry) => entry.id === id);
    expect(entries.find((entry) => entry.turnId === turnId)).toMatchObject({
      state: 'error',
      error: 'Interrupted: Tagalong closed before this finished.',
    });
    expect(byId(expert)).toMatchObject({ state: 'error' });
    expect(byId(expert)?.finishedAt).toBeDefined();
    expect(byId(routine)).toMatchObject({ state: 'done', answer: 'None today.' });
  });
});

describe('ActivityLog.prune, at boot', () => {
  it('deletes rows that started more than 90 days ago, and search forgets them', () => {
    const old = log.routineStarted({ routineId: randomUUID(), petId: 'scout', name: 'Papers' });
    log.routineFinished(old, { state: 'done', answer: 'None.' });
    const kept = log.routineStarted({ routineId: randomUUID(), petId: 'scout', name: 'Papers' });
    const at = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    db.prepare('UPDATE activity SET started_at = ? WHERE id = ?').run(at(91), old);
    db.prepare('UPDATE activity SET started_at = ? WHERE id = ?').run(at(89), kept);

    expect(log.prune()).toBe(1);

    expect(log.list({}).entries.map((entry) => entry.id)).toEqual([kept]);
    const indexed = db.prepare('SELECT COUNT(*) AS n FROM activity_fts').get() as { n: number };
    expect(indexed.n).toBe(1);
    expect(log.prune()).toBe(0);
  });
});

describe('ActivityLog.since, for the daily briefing', () => {
  /** Moves a row's start, since the log stamps rows with the real clock. */
  function at(id: string, startedAt: string): void {
    db.prepare('UPDATE activity SET started_at = ? WHERE id = ?').run(startedAt, id);
  }

  it('lists the shown kinds that started at or after the time, oldest first', () => {
    const before = log.expertStarted({ petId: 'scout', expertId: 'x', expertName: 'X', text: 'a' });
    const second = log.expertStarted({ petId: 'scout', expertId: 'x', expertName: 'X', text: 'b' });
    const first = log.routineStarted({ routineId: randomUUID(), petId: 'scout', name: 'Papers' });
    at(before, '2026-10-14T23:59:59.000Z');
    at(second, '2026-10-15T10:00:00.000Z');
    at(first, '2026-10-15T00:00:00.000Z');
    db.prepare(
      `INSERT INTO activity (id, kind, state, pet_id, started_at)
       VALUES ('old', 'consult', 'done', 'scout', '2026-10-15T11:00:00.000Z')`,
    ).run();

    expect(log.since('2026-10-15T00:00:00.000Z').map((entry) => entry.id)).toEqual([first, second]);
    expect(
      log
        .since('2026-10-15T00:00:00.000Z', 200, '2026-10-15T10:00:00.000Z')
        .map((entry) => entry.id),
    ).toEqual([first]);
  });

  it('stops at the limit, keeping the oldest', () => {
    const ids = [0, 1, 2].map((n) => {
      const id = log.expertStarted({
        petId: 'scout',
        expertId: 'x',
        expertName: 'X',
        text: `${n}`,
      });
      at(id, `2026-10-15T0${n}:00:00.000Z`);
      return id;
    });

    expect(log.since('2026-10-15T00:00:00.000Z', 2).map((entry) => entry.id)).toEqual(
      ids.slice(0, 2),
    );
  });
});
