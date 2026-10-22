/** Tests for ExperienceLog: turns from events, check-ins, outcomes, paging, secrets and pruning. */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Asks } from '../asks/asks';
import { AskStore } from '../asks/store';
import { openDatabase } from './db';
import { EXPERIENCE_INPUT_CHARS, EXPERIENCE_KEEP_DAYS, ExperienceLog } from './experience';
import { ConversationStore } from './store';

let dataDir: string;
let db: Database.Database;
let store: ConversationStore;
let log: ExperienceLog;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-experience-'));
  db = openDatabase(dataDir);
  store = new ConversationStore(db);
  log = new ExperienceLog(db, store);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

/** A conversation whose last message is the question, as the runner leaves it. */
function asked(text: string): string {
  const conversation = store.createConversation({ petId: 'scout' });
  store.appendMessage({
    conversationId: conversation.id,
    role: 'user',
    content: [{ type: 'text', text }],
  });
  return conversation.id;
}

function started(
  conversationId: string,
  extra: { jobId?: string; routineId?: string; spoken?: true } = {},
) {
  const turnId = randomUUID();
  log.observe({
    method: 'turn.started',
    params: {
      turnId,
      petId: 'scout',
      conversationId,
      providerId: 'fake',
      model: 'fake-model',
      ...extra,
    },
  });
  return turnId;
}

function completed(turnId: string, text: string, stopReason: 'end' | 'aborted' = 'end') {
  log.observe({
    method: 'turn.completed',
    params: {
      turnId,
      text,
      stopReason,
      usage: { inputTokens: 1200, outputTokens: 80 },
      modelCalls: 2,
    },
  });
}

function only() {
  const [episode] = log.list({}).episodes;
  if (episode === undefined) throw new Error('no episode');
  return log.get(episode.id)!;
}

describe('ExperienceLog: turns', () => {
  it('records a turn from its events: the question, each tool call, the answer and the cost', () => {
    const turnId = started(asked('what is this error?'));
    log.observe({
      method: 'turn.toolRequest',
      params: { turnId, approvalId: randomUUID(), tool: 'read_window_text', input: { id: 7 } },
    });
    log.observe({
      method: 'turn.toolResult',
      params: { turnId, tool: 'read_window_text', ok: true, summary: 'EADDRINUSE :3000' },
    });
    log.observe({
      method: 'turn.toolRequest',
      params: { turnId, approvalId: randomUUID(), tool: 'remember', input: { text: 'x' } },
    });
    log.observe({
      method: 'turn.toolResult',
      params: { turnId, tool: 'remember', ok: true, summary: 'Saved.' },
    });
    completed(turnId, 'Port 3000 is taken by another server.');

    const { episode, events } = only();
    expect(episode).toMatchObject({
      mode: 'turn',
      trigger: 'asked',
      ref: turnId,
      model: 'fake-model',
      input: 'what is this error?',
      decision: 'answered',
      said: 'Port 3000 is taken by another server.',
      inputTokens: 1200,
      outputTokens: 80,
      modelCalls: 2,
    });
    expect(episode.endedAt).toBeDefined();
    expect(events).toEqual([
      // What a screen tool read is never kept: only how much there was.
      expect.objectContaining({
        kind: 'step',
        name: 'read_window_text',
        input: '{"id":7}',
        result: '[screen text, 16 characters, not kept]',
        ok: true,
      }),
      expect.objectContaining({ kind: 'step', name: 'remember', result: 'Saved.', ok: true }),
    ]);
  });

  it('keeps no window titles from a history search either: only the marker', () => {
    const turnId = started(asked('what was that article?'));
    log.observe({
      method: 'turn.toolRequest',
      params: { turnId, approvalId: randomUUID(), tool: 'search_history', input: {} },
    });
    const titles = 'Tue 13 Oct 14:05 saw in chrome: "Re: offer letter - Inbox" (2)';
    log.observe({
      method: 'turn.toolResult',
      params: { turnId, tool: 'search_history', ok: true, summary: titles },
    });
    completed(turnId, 'The offer letter.');

    const [step] = only().events;
    expect(step?.result).toBe(`[screen text, ${titles.length} characters, not kept]`);
    expect(JSON.stringify(only())).not.toContain('offer letter - Inbox');
  });

  it('matches each result to its call by the call id, even two of one tool at once', () => {
    const turnId = started(asked('both'));
    for (const callId of ['c1', 'c2']) {
      log.observe({
        method: 'turn.toolRequest',
        params: { turnId, approvalId: randomUUID(), callId, tool: 'recall', input: { q: callId } },
      });
    }
    // The first call finishes first: by name alone it would land on the newest call.
    log.observe({
      method: 'turn.toolResult',
      params: { turnId, callId: 'c1', tool: 'recall', ok: true, summary: 'first' },
    });
    log.observe({
      method: 'turn.toolResult',
      params: { turnId, callId: 'c2', tool: 'recall', ok: false, summary: 'second' },
    });
    completed(turnId, 'ok');
    expect(only().events).toEqual([
      expect.objectContaining({ input: '{"q":"c1"}', result: 'first', ok: true }),
      expect.objectContaining({ input: '{"q":"c2"}', result: 'second', ok: false }),
    ]);
  });

  it('says a spoken question was spoken', () => {
    completed(started(asked('hello'), { spoken: true }), 'Hi.');
    expect(only().episode).toMatchObject({ mode: 'turn', trigger: 'voice' });
  });

  it('tells a job and a routine from a turn they asked for', () => {
    started(asked('find the flaky test'), { jobId: randomUUID() });
    started(asked('Morning brief'), { routineId: 'r1' });
    const [routine, job] = log.list({}).episodes;
    expect(job).toMatchObject({ mode: 'job', trigger: 'job' });
    expect(routine).toMatchObject({ mode: 'routine', trigger: 'routine' });
  });

  it('records a stopped turn and a failed one', () => {
    const stopped = started(asked('one'));
    completed(stopped, '', 'aborted');
    const failed = started(asked('two'));
    log.observe({
      method: 'turn.error',
      params: { turnId: failed, code: 'auth', message: 'The key was refused.' },
    });
    const [error, aborted] = log.list({}).episodes;
    expect(aborted).toMatchObject({ decision: 'stopped' });
    expect(error).toMatchObject({ decision: 'error', note: 'The key was refused.' });
  });

  it('hides secrets in what it keeps', () => {
    const turnId = started(asked('my token is sk-abcdefghijklmnopqrstuvwxyz0123456789'));
    completed(turnId, 'Done.');
    expect(only().episode.input).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('ExperienceLog: check-ins', () => {
  it('records every check-in decision, silence included, with what the mind was shown', () => {
    log.checkIn({
      ref: randomUUID(),
      petId: 'scout',
      trigger: 'trouble',
      model: 'sonnet',
      input: 'Why you woke: an error in the terminal.',
      decision: 'quiet',
    });
    expect(only().episode).toMatchObject({
      mode: 'check-in',
      trigger: 'trouble',
      decision: 'quiet',
      input: 'Why you woke: an error in the terminal.',
    });
  });

  it('clips a long bundle', () => {
    log.checkIn({
      ref: randomUUID(),
      petId: 'scout',
      trigger: 'launch',
      input: 'x'.repeat(EXPERIENCE_INPUT_CHARS + 50),
      decision: 'spoke',
      said: 'Morning.',
    });
    expect(only().episode.input).toHaveLength(EXPERIENCE_INPUT_CHARS);
  });
});

describe('ExperienceLog: outcomes', () => {
  it('ties what the person did to the episode it answers, by its ref', () => {
    const remarkId = randomUUID();
    log.checkIn({
      ref: remarkId,
      petId: 'scout',
      trigger: 'settled',
      input: 'bundle',
      decision: 'offered',
      said: 'Want Claude Code to look at that test?',
      note: 'fix the flaky test',
    });
    expect(log.outcome(remarkId, 'accepted')).toBe(true);
    expect(log.outcome(randomUUID(), 'accepted')).toBe(false);
    expect(only().events).toEqual([expect.objectContaining({ kind: 'outcome', name: 'accepted' })]);
  });

  it('records how an ask ended on the episode of the turn that asked, by the ask states', async () => {
    const asks = new Asks({
      store: new AskStore(db),
      emit: () => undefined,
      outcome: (turnId, name) => void log.outcome(turnId, name),
    });
    const handedOff = started(asked('fix it'));
    const wrote = started(asked('make a page'));
    const quiet = started(asked('another page'));
    // A card from no turn (a check-in offer, Brief again) is tied to nothing.
    const card = asks.add({
      petId: 'scout',
      expertId: 'c',
      summary: 'Fix it',
      payload: {},
      originTurnId: handedOff,
    });
    asks.add({ petId: 'scout', expertId: 'c', summary: 'Loose', payload: {} });
    asks.answer(card.id, 'decline');
    const write = {
      petId: 'scout',
      app: 'Notion',
      tool: 'create_page',
      summary: 'Create',
      risk: 'change' as const,
    };
    const approved = asks.hold({ ...write, turnId: wrote }, new AbortController().signal);
    asks.answer(asks.waiting().find((row) => row.originTurnId === wrote)!.id, 'approve');
    await approved;
    void asks.hold({ ...write, turnId: quiet }, new AbortController().signal);
    asks.closeHeld();
    const outcomeOf = (turnId: string) =>
      log
        .get(log.list({}).episodes.find((episode) => episode.ref === turnId)!.id)!
        .events.filter((event) => event.kind === 'outcome')
        .map((event) => event.name);
    expect(outcomeOf(handedOff)).toEqual(['declined']);
    expect(outcomeOf(wrote)).toEqual(['approved']);
    expect(outcomeOf(quiet)).toEqual(['expired']);
    asks.stop();
  });
});

describe('ExperienceLog: since', () => {
  it('gives the episodes that ended after a time, oldest first, with their events, newest kept', () => {
    const before = new Date(Date.now() - 1000).toISOString();
    for (const text of ['a', 'b', 'c']) completed(started(asked(text)), text);
    const remarkId = randomUUID();
    log.checkIn({ ref: remarkId, petId: 'scout', trigger: 'back', input: 'x', decision: 'spoke' });
    log.outcome(remarkId, 'not-now');
    const all = log.since(before, 10);
    expect(all.map(({ episode }) => episode.input)).toEqual(['a', 'b', 'c', 'x']);
    expect(all.at(-1)?.events).toEqual([expect.objectContaining({ name: 'not-now' })]);
    expect(log.since(before, 2).map(({ episode }) => episode.input)).toEqual(['c', 'x']);
    expect(log.since(new Date(Date.now() + 60_000).toISOString(), 10)).toEqual([]);
  });
});

describe('ExperienceLog: paging, boot and pruning', () => {
  it('pages newest first', () => {
    for (const text of ['a', 'b', 'c']) completed(started(asked(text)), text);
    const first = log.list({ limit: 2 });
    expect(first.episodes.map((episode) => episode.input)).toEqual(['c', 'b']);
    expect(log.list({ before: first.next!, limit: 2 }).episodes.map((e) => e.input)).toEqual(['a']);
  });

  it('closes episodes a quit left running, as stopped', () => {
    started(asked('cut short'));
    expect(log.interrupted()).toBe(1);
    expect(only().episode).toMatchObject({ decision: 'stopped' });
  });

  it('deletes everything at once: Delete all', () => {
    const remarkId = randomUUID();
    log.checkIn({ ref: remarkId, petId: 'scout', trigger: 'back', input: 'x', decision: 'spoke' });
    log.outcome(remarkId, 'not-now');
    completed(started(asked('a')), 'b');
    expect(log.clear()).toBe(2);
    expect(log.list({}).episodes).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM episode_events').get()).toEqual({ n: 0 });
  });

  it(`forgets episodes older than ${EXPERIENCE_KEEP_DAYS} days, and their events`, () => {
    const remarkId = randomUUID();
    log.checkIn({ ref: remarkId, petId: 'scout', trigger: 'back', input: 'x', decision: 'spoke' });
    log.outcome(remarkId, 'not-now');
    const old = new Date(Date.now() - (EXPERIENCE_KEEP_DAYS + 1) * 86_400_000).toISOString();
    db.prepare('UPDATE episodes SET started_at = ?').run(old);
    expect(log.prune()).toBe(1);
    expect(log.list({}).episodes).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM episode_events').get()).toEqual({ n: 0 });
  });
});
