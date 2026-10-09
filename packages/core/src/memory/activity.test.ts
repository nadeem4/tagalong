import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { ActivityLog } from './activity';
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

function started(petId: string, conversationId: string, extra: { runId?: string } = {}): string {
  const turnId = randomUUID();
  log.observe({
    method: 'turn.started',
    params: { turnId, petId, conversationId, providerId: 'fake', model: 'fake-model', ...extra },
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

describe('ActivityLog: the crew', () => {
  it('records a consult with its question, then its answer', () => {
    const turnId = started('scout', asked('scout', 'help me word this'));
    log.observe({
      method: 'pet.message',
      params: { fromPetId: 'scout', toPetId: 'ink', kind: 'consult', text: 'Tighter?', turnId },
    });
    log.consultAnswered(turnId, 'ink', { ok: true, text: 'Cut the second clause.' });
    const consult = log.list({}).entries.find((entry) => entry.kind === 'consult');
    expect(consult).toMatchObject({
      petId: 'scout',
      toPetId: 'ink',
      turnId,
      text: 'Tighter?',
      answer: 'Cut the second clause.',
      state: 'done',
    });
  });

  it('records a consult that went unanswered as an error', () => {
    const turnId = started('scout', asked('scout', 'q'));
    log.observe({
      method: 'pet.message',
      params: {
        fromPetId: 'scout',
        toPetId: 'bolt',
        kind: 'consult',
        text: 'Is it the port?',
        turnId,
      },
    });
    log.consultAnswered(turnId, 'bolt', {
      ok: false,
      text: 'Bolt did not answer within 60 seconds.',
    });
    expect(log.list({}).entries.find((entry) => entry.kind === 'consult')).toMatchObject({
      state: 'error',
      error: 'Bolt did not answer within 60 seconds.',
    });
  });

  it('records a handoff, finished when the receiving turn is', () => {
    const conversationId = asked('ink', 'Scout handed this over to you.');
    const turnId = randomUUID();
    log.observe({
      method: 'pet.message',
      params: {
        fromPetId: 'scout',
        toPetId: 'ink',
        kind: 'handoff',
        text: 'The user asked for a cover letter.',
        turnId,
        conversationId,
      },
    });
    log.observe({
      method: 'turn.started',
      params: { turnId, petId: 'ink', conversationId, providerId: 'fake', model: 'fake-model' },
    });
    completed(turnId, 'Here it is.');
    const handoff = log.list({}).entries.find((entry) => entry.kind === 'handoff');
    expect(handoff).toMatchObject({
      petId: 'scout',
      toPetId: 'ink',
      text: 'The user asked for a cover letter.',
      state: 'done',
    });
  });

  it('records a roundtable once, with its state and calls from crew.status', () => {
    const runId = randomUUID();
    log.observe({
      method: 'crew.status',
      params: { runId, kind: 'roundtable', state: 'running', round: 0, rounds: 2, modelCalls: 0 },
    });
    for (const [toPetId, round] of [
      ['scout', 1],
      ['scout', 2],
    ] as const) {
      log.observe({
        method: 'pet.message',
        params: {
          fromPetId: 'scout',
          toPetId,
          kind: 'roundtable',
          text: `Round ${round}`,
          runId,
          round,
        },
      });
    }
    started('scout', asked('scout', 'The user put this question to the whole crew'), { runId });
    log.observe({
      method: 'crew.status',
      params: { runId, kind: 'roundtable', state: 'done', round: 2, rounds: 2, modelCalls: 4 },
    });
    const tables = log.list({}).entries.filter((entry) => entry.kind === 'roundtable');
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ petId: 'scout', runId, state: 'done', modelCalls: 4 });
    expect(log.list({}).entries.find((entry) => entry.kind === 'turn')?.runId).toBe(runId);
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
});
