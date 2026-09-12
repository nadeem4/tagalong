import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { ContextSnapshot, Pet } from '@tagalong/protocol';
import { openDatabase } from '../memory/db';
import { ConversationStore } from '../memory/store';
import { SettingsStore } from '../settings/settings';
import { BrainError, FakeBrainProvider } from '../providers';
import type { BrainEvents, BrainProvider, BrainRequest, BrainResult } from '../providers';
import { ConversationRunner, type TurnEvent } from './runner';

const pet: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🐾',
  persona: 'You are Scout.',
  model: 'fake-model',
  providerId: 'fake',
  toolAllowlist: [],
  replyStyle: 'text',
};

const snapshot: ContextSnapshot = {
  id: randomUUID(),
  capturedAt: new Date().toISOString(),
  host: 'desktop',
  selection: 'the highlighted paragraph',
};

let dir: string;
let db: Database;
let store: ConversationStore;
let settings: SettingsStore;
let events: TurnEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-runner-'));
  db = openDatabase(dir);
  store = new ConversationStore(db);
  settings = new SettingsStore(dir);
  events = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function makeRunner(provider: BrainProvider): ConversationRunner {
  return new ConversationRunner({
    store,
    settings,
    provider,
    emit: (event) => events.push(event),
  });
}

function methods(): string[] {
  return events.map((event) => event.method);
}

/** Waits for the first streamed delta so a test can interrupt mid-turn. */
function firstDelta(): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (methods().includes('turn.delta')) resolve();
      else setTimeout(check, 1);
    };
    check();
  });
}

describe('ConversationRunner.run', () => {
  it('emits started, then deltas, then completed', async () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'hello there friend' }));
    const turn = runner.run({ pet, text: 'hi' });
    const outcome = await turn.done;

    expect(methods()[0]).toBe('turn.started');
    expect(methods().at(-1)).toBe('turn.completed');
    expect(
      methods()
        .slice(1, -1)
        .every((method) => method === 'turn.delta'),
    ).toBe(true);
    expect(methods().filter((m) => m === 'turn.delta')).toHaveLength(3);
    expect(events.every((event) => event.params.turnId === turn.turnId)).toBe(true);
    expect(outcome.text).toBe('hello there friend');
    expect(outcome.stopReason).toBe('end');
    expect(outcome.usage.outputTokens).toBeGreaterThan(0);
  });

  it('creates a conversation and stores both sides of the exchange', async () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'an answer' }));
    const turn = runner.run({ pet, text: 'hi', snapshot });
    await turn.done;

    const messages = store.listMessages(turn.conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(messages[0]?.snapshot?.selection).toBe('the highlighted paragraph');
    expect(messages[1]?.content).toEqual([{ type: 'text', text: 'an answer' }]);
    expect(store.getConversation(turn.conversationId)?.petId).toBe('scout');
  });

  it('continues an existing conversation and replays its history', async () => {
    const seen: BrainRequest[] = [];
    const runner = makeRunner(recording(seen, 'second answer'));

    const first = runner.run({ pet, text: 'first question' });
    await first.done;
    const second = runner.run({ pet, conversationId: first.conversationId, text: 'and then?' });
    await second.done;

    expect(second.conversationId).toBe(first.conversationId);
    expect(seen[1]?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(store.listMessages(first.conversationId)).toHaveLength(4);
  });

  it('replays no more than the configured history window', async () => {
    settings.set({ historyMessages: 2 });
    const seen: BrainRequest[] = [];
    const runner = makeRunner(recording(seen, 'ok'));

    const first = runner.run({ pet, text: 'one' });
    await first.done;
    const second = runner.run({ pet, conversationId: first.conversationId, text: 'two' });
    await second.done;

    expect(seen[1]?.messages).toHaveLength(2);
  });
});

describe('ConversationRunner.interrupt', () => {
  it('aborts a running turn', async () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'one two three four', delayMs: 5 }));
    const turn = runner.run({ pet, text: 'hi' });

    await firstDelta();
    expect(runner.interrupt(turn.turnId)).toBe(true);
    const outcome = await turn.done;

    expect(outcome.stopReason).toBe('aborted');
    expect(methods().at(-1)).toBe('turn.completed');
    const completed = events.at(-1);
    expect(completed?.method === 'turn.completed' && completed.params.stopReason).toBe('aborted');
  });

  it('reports nothing to abort for an unknown turn', () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'hi' }));
    expect(runner.interrupt(randomUUID())).toBe(false);
  });

  it('interrupts the running turn when the same pet is asked again', async () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'one two three four', delayMs: 5 }));
    const first = runner.run({ pet, text: 'hi' });
    await firstDelta();

    const second = runner.run({ pet, text: 'actually, this instead' });
    const firstOutcome = await first.done;
    const secondOutcome = await second.done;

    expect(firstOutcome.stopReason).toBe('aborted');
    expect(secondOutcome.stopReason).toBe('end');
  });

  it('leaves a turn belonging to another pet alone', async () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'one two three four', delayMs: 5 }));
    const first = runner.run({ pet, text: 'hi' });
    await firstDelta();

    const second = runner.run({ pet: { ...pet, id: 'echo' }, text: 'hi to you' });
    const [firstOutcome, secondOutcome] = await Promise.all([first.done, second.done]);

    expect(firstOutcome.stopReason).toBe('end');
    expect(secondOutcome.stopReason).toBe('end');
  });
});

describe('ConversationRunner failures', () => {
  it('maps a BrainError to turn.error with its code', async () => {
    const runner = makeRunner(failing(new BrainError('rate_limit', 'Slow down.')));
    const outcome = await runner.run({ pet, text: 'hi' }).done;

    expect(methods()).toEqual(['turn.started', 'turn.error']);
    const error = events.at(-1);
    expect(error?.method === 'turn.error' && error.params.code).toBe('rate_limit');
    expect(outcome.error?.message).toBe('Slow down.');
    expect(outcome.stopReason).toBe('error');
  });

  it('falls back to an unknown code for anything else', async () => {
    const runner = makeRunner(failing(new Error('socket exploded')));
    await runner.run({ pet, text: 'hi' }).done;

    const error = events.at(-1);
    expect(error?.method === 'turn.error' && error.params.code).toBe('unknown');
  });

  it('does not store an assistant message for a failed turn', async () => {
    const runner = makeRunner(failing(new BrainError('auth', 'No key.')));
    const turn = runner.run({ pet, text: 'hi' });
    await turn.done;

    expect(store.listMessages(turn.conversationId).map((m) => m.role)).toEqual(['user']);
  });
});

/** Captures the assembled requests so a test can assert on what the model was sent. */
function recording(into: BrainRequest[], reply: string): BrainProvider {
  const fake = new FakeBrainProvider({ text: reply });
  return {
    id: 'recording',
    capabilities: fake.capabilities,
    listModels: () => fake.listModels(),
    complete: (req: BrainRequest, events_: BrainEvents, signal: AbortSignal) => {
      into.push(req);
      return fake.complete(req, events_, signal);
    },
  };
}

function failing(error: unknown): BrainProvider {
  return {
    id: 'failing',
    capabilities: { vision: false, tools: false, streaming: false },
    listModels: () => Promise.resolve([]),
    complete: (): Promise<BrainResult> => Promise.reject(error),
  };
}

describe('interruptAll', () => {
  it('aborts every running turn so shutdown leaves no stream in flight', async () => {
    const runner = makeRunner(
      new FakeBrainProvider({ text: 'one two three four five', delayMs: 20 }),
    );
    const first = runner.run({ pet, text: 'a' });
    const second = runner.run({ pet: { ...pet, id: 'other' }, text: 'b' });
    await firstDelta();

    const aborted = runner.interruptAll();

    expect(aborted).toBeGreaterThan(0);
    expect((await first.done).stopReason).toBe('aborted');
    expect((await second.done).stopReason).toBe('aborted');
  });

  it('reports zero when nothing is running', () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'idle' }));

    expect(runner.interruptAll()).toBe(0);
  });
});
