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
import type { FakeScript } from '../providers';
import type { BrainEvents, BrainProvider, BrainRequest, BrainResult } from '../providers';
import {
  GET_SELECTION,
  LOOK_AT_SCREEN,
  createPerceptionToolset,
  type PerceptionHost,
  type PerceptionToolset,
  type ToolOutcome,
} from '../perception';
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

function makeRunner(provider: BrainProvider, tools?: PerceptionToolset): ConversationRunner {
  return new ConversationRunner({
    store,
    settings,
    provider,
    emit: (event) => events.push(event),
    ...(tools ? { tools } : {}),
  });
}

/** A host that answers perception.capture from a canned snapshot. No socket, no screen. */
function fakeHost(patch: {
  app?: { name: string; windowTitle?: string };
  selection?: string;
}): PerceptionHost {
  return {
    capabilities: ['screenshot', 'selection', 'activeWindow'],
    capture: (what) =>
      Promise.resolve({
        ...(what.includes('activeWindow') && patch.app ? { app: patch.app } : {}),
        ...(what.includes('selection') && patch.selection !== undefined
          ? { selection: patch.selection }
          : {}),
        ...(what.includes('screenshot')
          ? {
              screenshot: {
                mime: 'image/png' as const,
                base64: 'iVBORw0KGgo=',
                width: 1280,
                height: 720,
              },
            }
          : {}),
      }),
  };
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

describe('ConversationRunner perception tools', () => {
  const host = fakeHost({
    app: { name: 'chrome.exe', windowTitle: 'Quarterly report' },
    selection: 'revenue fell 4% in Q3',
  });

  const NO_EXCLUSIONS = { processNames: [] as string[], titlePatterns: [] as string[] };

  /**
   * `vision` is explicit because the toolset defaults to *no* vision, and a test that
   * leaves it out is testing the blind path whatever its name claims.
   */
  function toolsFor(
    hosts: readonly PerceptionHost[],
    exclusions = NO_EXCLUSIONS,
    vision = false,
  ): PerceptionToolset {
    return createPerceptionToolset({
      hosts: () => hosts,
      exclusions: () => exclusions,
      vision: () => vision,
    });
  }

  it('offers the built-in tools to a provider that supports them', async () => {
    const observed = observing({ text: 'ok' });
    const runner = makeRunner(observed.provider, toolsFor([host]));
    await runner.run({ pet, text: 'hi' }).done;

    expect(observed.requests[0]?.tools?.map((tool) => tool.name)).toEqual([
      LOOK_AT_SCREEN,
      GET_SELECTION,
    ]);
  });

  it('offers no tools to a provider without tool support', async () => {
    const seen: BrainRequest[] = [];
    const runner = makeRunner(toolless(seen), toolsFor([host]));
    await runner.run({ pet, text: 'hi' }).done;

    expect(seen[0]?.tools).toBeUndefined();
  });

  it('describes look_at_screen in words when the pet cannot see images', async () => {
    const observed = observing({
      text: 'I cannot look at it',
      toolCall: { id: 'call-1', name: LOOK_AT_SCREEN, input: {} },
    });
    const runner = makeRunner(observed.provider, toolsFor([host]));
    const outcome = await runner.run({ pet, text: 'what is this?' }).done;

    expect(observed.toolResults).toHaveLength(1);
    expect(observed.toolResults[0]?.isError).toBeFalsy();
    expect(observed.toolResults[0]?.content).toContain('Quarterly report');
    expect(observed.toolResults[0]?.content).toContain('1280');
    expect(outcome.text).toBe('I cannot look at it');
    expect(outcome.stopReason).toBe('end');
  });

  it('hands look_at_screen the pixels themselves when the pet can see', async () => {
    const observed = observing({
      text: 'I can see it',
      toolCall: { id: 'call-1b', name: LOOK_AT_SCREEN, input: {} },
    });
    const runner = makeRunner(observed.provider, toolsFor([host], NO_EXCLUSIONS, true));
    const outcome = await runner.run({ pet, text: 'what is this?' }).done;

    const content = observed.toolResults[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toContainEqual({
      type: 'image',
      mime: 'image/png',
      base64: 'iVBORw0KGgo=',
    });
    expect(outcome.text).toBe('I can see it');
  });

  it('returns the fake host selection into the turn for get_selection', async () => {
    const observed = observing({
      text: 'that is the revenue line',
      toolCall: { id: 'call-2', name: GET_SELECTION, input: {} },
    });
    const runner = makeRunner(observed.provider, toolsFor([host]));
    await runner.run({ pet, text: 'what is this?' }).done;

    expect(observed.toolResults[0]?.content).toContain('revenue fell 4% in Q3');
  });

  it('answers with a refusal when the active window is excluded', async () => {
    const secret = fakeHost({ app: { name: '1Password.exe' }, selection: 'hunter2' });
    const observed = observing({
      text: 'I cannot look there',
      toolCall: { id: 'call-3', name: LOOK_AT_SCREEN, input: {} },
    });
    const runner = makeRunner(
      observed.provider,
      toolsFor([secret], { processNames: ['1Password.exe'], titlePatterns: [] }),
    );
    await runner.run({ pet, text: 'what is this?' }).done;

    expect(observed.toolResults[0]?.isError).toBe(true);
    expect(observed.toolResults[0]?.content).toContain('blocked');
  });

  it('tells the model there are no tools when none are wired up', async () => {
    const observed = observing({
      text: 'nothing to use',
      toolCall: { id: 'call-4', name: LOOK_AT_SCREEN, input: {} },
    });
    const runner = makeRunner(observed.provider);
    await runner.run({ pet, text: 'what is this?' }).done;

    expect(observed.toolResults[0]?.isError).toBe(true);
    expect(observed.requests[0]?.tools).toBeUndefined();
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

/**
 * Wraps the fake provider so a test can see the tool results the runner fed back.
 * The fake awaits `onToolUse` and then discards the answer, which is exactly what a real
 * provider does with it — but the answer is the thing under test here.
 */
function observing(script: FakeScript): {
  provider: BrainProvider;
  requests: BrainRequest[];
  toolResults: ToolOutcome[];
} {
  const fake = new FakeBrainProvider(script);
  const requests: BrainRequest[] = [];
  const toolResults: ToolOutcome[] = [];
  return {
    requests,
    toolResults,
    provider: {
      id: 'observing',
      capabilities: fake.capabilities,
      listModels: () => fake.listModels(),
      complete: (req, events_, signal) => {
        requests.push(req);
        return fake.complete(
          req,
          {
            onText: (delta) => events_.onText(delta),
            onToolUse: async (call) => {
              const result = await events_.onToolUse(call);
              toolResults.push(result);
              return result;
            },
          },
          signal,
        );
      },
    },
  };
}

/** A provider that streams like the fake but advertises no tool support. */
function toolless(into: BrainRequest[]): BrainProvider {
  const fake = new FakeBrainProvider({ text: 'no tools here' });
  return {
    id: 'toolless',
    capabilities: { vision: false, tools: false, streaming: true },
    listModels: () => fake.listModels(),
    complete: (req, events_, signal) => {
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

const SCREENSHOT = {
  mime: 'image/png',
  base64: 'iVBORw0KGgoSECRETPIXELS',
  width: 1280,
  height: 720,
} as const;

function shotSnapshot(): ContextSnapshot {
  return {
    id: randomUUID(),
    capturedAt: new Date().toISOString(),
    host: 'desktop',
    selection: 'the highlighted paragraph',
    screenshot: { ...SCREENSHOT },
  };
}

/** Reads the raw column, because the point is what landed on disk, not what was returned. */
function storedSnapshotJson(conversationId: string): string | null {
  return (
    db
      .prepare<[string], { snapshot_json: string | null }>(
        "SELECT snapshot_json FROM messages WHERE conversation_id = ? AND role = 'user'",
      )
      .get(conversationId)?.snapshot_json ?? null
  );
}

/** Records requests and advertises no vision, which is the condition under test. */
function blind(into: BrainRequest[]): BrainProvider {
  const fake = new FakeBrainProvider({ text: 'I cannot see images' });
  return {
    id: 'blind',
    capabilities: { vision: false, tools: true, streaming: true },
    listModels: () => fake.listModels(),
    complete: (req, events_, signal) => {
      into.push(req);
      return fake.complete(req, events_, signal);
    },
  };
}

function imageBlocks(request: BrainRequest | undefined): unknown[] {
  return (request?.messages ?? []).flatMap((message) =>
    message.content.filter((block) => block.type === 'image'),
  );
}

describe('ConversationRunner screenshot persistence', () => {
  it('keeps the screenshot out of the database under the shipped default', async () => {
    const seen: BrainRequest[] = [];
    const runner = makeRunner(recording(seen, 'ok'));
    const turn = runner.run({ pet, text: 'what is this?', snapshot: shotSnapshot() });
    await turn.done;

    const stored = storedSnapshotJson(turn.conversationId);
    expect(stored).not.toContain(SCREENSHOT.base64);
    expect(stored).toContain('the highlighted paragraph');
    expect(store.listMessages(turn.conversationId)[0]?.snapshot?.screenshot).toBeUndefined();
    // The pet still sees what it was shown; the promise is about the disk, not its eyes.
    expect(imageBlocks(seen[0])).toHaveLength(1);
  });

  it('keeps the screenshot once a retention window is set', async () => {
    settings.set({ screenshotRetention: { mode: 'hours', hours: 24 } });
    const runner = makeRunner(new FakeBrainProvider({ text: 'ok' }));
    const turn = runner.run({ pet, text: 'what is this?', snapshot: shotSnapshot() });
    await turn.done;

    expect(storedSnapshotJson(turn.conversationId)).toContain(SCREENSHOT.base64);
  });

  it('stores a snapshot that never had a screenshot untouched', async () => {
    const runner = makeRunner(new FakeBrainProvider({ text: 'ok' }));
    const turn = runner.run({ pet, text: 'hi', snapshot });
    await turn.done;

    expect(storedSnapshotJson(turn.conversationId)).toContain('the highlighted paragraph');
  });
});

describe('ConversationRunner vision capability', () => {
  it('drops the image and warns when the provider cannot see', async () => {
    const seen: BrainRequest[] = [];
    const runner = makeRunner(blind(seen));
    const turn = runner.run({ pet, text: 'what is this?', snapshot: shotSnapshot() });
    await turn.done;

    expect(imageBlocks(seen[0])).toHaveLength(0);
    expect(JSON.stringify(seen[0])).not.toContain(SCREENSHOT.base64);

    const warning = events.find((event) => event.method === 'turn.warning');
    expect(warning?.params).toMatchObject({ turnId: turn.turnId, code: 'vision_unsupported' });
    // Non-fatal: the turn still answers, so the host must not treat it as a failure.
    expect(methods().at(-1)).toBe('turn.completed');
  });

  it('leaves the image alone for a provider that can see', async () => {
    const seen: BrainRequest[] = [];
    const runner = makeRunner(recording(seen, 'ok'));
    await runner.run({ pet, text: 'what is this?', snapshot: shotSnapshot() }).done;

    expect(imageBlocks(seen[0])).toHaveLength(1);
    expect(methods()).not.toContain('turn.warning');
  });

  it('warns about nothing when a blind provider gets no screenshot', async () => {
    const seen: BrainRequest[] = [];
    const runner = makeRunner(blind(seen));
    await runner.run({ pet, text: 'hi', snapshot }).done;

    expect(methods()).not.toContain('turn.warning');
  });
});

describe('ConversationRunner retention sweep', () => {
  it('clears already-stored screenshots once retention is switched off', async () => {
    settings.set({ screenshotRetention: { mode: 'hours', hours: 24 } });
    const runner = makeRunner(new FakeBrainProvider({ text: 'ok' }));
    const first = runner.run({ pet, text: 'what is this?', snapshot: shotSnapshot() });
    await first.done;
    expect(storedSnapshotJson(first.conversationId)).toContain(SCREENSHOT.base64);

    settings.set({ screenshotRetention: { mode: 'off' } });
    await runner.run({ pet, conversationId: first.conversationId, text: 'and now?' }).done;

    expect(storedSnapshotJson(first.conversationId)).not.toContain(SCREENSHOT.base64);
  });
});
