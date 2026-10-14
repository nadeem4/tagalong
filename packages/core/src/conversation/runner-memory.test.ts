import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { Pet } from '@tagalong/protocol';
import { openDatabase } from '../memory/db';
import { MemoryStore } from '../memory/memories';
import { ConversationStore } from '../memory/store';
import { SettingsStore } from '../settings/settings';
import { FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest, FakeScript } from '../providers';
import { SUMMARY_KEEP_RECENT, Summarizer } from '../memory/summarizer';
import { REMEMBER } from '../tools';
import { MEMORY_HEADING } from './prompt-assembler';
import { ConversationRunner, type TurnEvent } from './runner';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  notes: 'You are Scout.',
  model: 'fake-model',
  providerId: 'fake',
  roleId: 'companion',
  toolGrants: {},
  replyStyle: 'text',
};

let dir: string;
let db: Database;
let memories: MemoryStore;
let events: TurnEvent[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-runner-memory-'));
  db = openDatabase(dir);
  memories = new MemoryStore(db);
  events = [];
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function recordingFake(script: FakeScript, into: BrainRequest[]): BrainProvider {
  const fake = new FakeBrainProvider(script);
  return {
    id: 'recording',
    capabilities: fake.capabilities,
    listModels: () => fake.listModels(),
    complete: (req, handlers, signal) => {
      into.push(req);
      return fake.complete(req, handlers, signal);
    },
  };
}

function runner(provider: BrainProvider): ConversationRunner {
  return new ConversationRunner({
    store: new ConversationStore(db),
    settings: new SettingsStore(dir),
    provider,
    emit: (event) => events.push(event),
    memory: memories,
  });
}

describe('recall in a turn', () => {
  it('sends what the pet remembers, matched against the question and the selection', async () => {
    memories.add({
      scope: 'pet',
      petId: 'scout',
      kind: 'preference',
      text: 'Prefers short answers',
    });
    memories.add({ scope: 'pet', petId: 'ink', kind: 'fact', text: 'Ink only knows this' });
    const requests: BrainRequest[] = [];

    await runner(recordingFake({ text: 'ok' }, requests)).run({ pet: scout, text: 'hello' }).done;

    expect(requests[0]?.system).toContain(MEMORY_HEADING);
    expect(requests[0]?.system).toContain('Prefers short answers');
    expect(requests[0]?.system).not.toContain('Ink only knows this');
  });

  it('offers the remember tool and files what the pet saves', async () => {
    const requests: BrainRequest[] = [];
    const provider = recordingFake(
      {
        text: 'Noted.',
        toolCall: {
          id: 'mem-1',
          name: REMEMBER,
          input: { text: 'Works in TypeScript', kind: 'fact', shared: true },
        },
      },
      requests,
    );

    await runner(provider).run({ pet: scout, text: 'I write TypeScript all day' }).done;

    expect(requests[0]?.tools?.map((tool) => tool.name)).toContain(REMEMBER);
    expect(memories.recent('ink', 5).map((m) => m.text)).toEqual(['Works in TypeScript']);
    const result = events.find((event) => event.method === 'turn.toolResult');
    expect(result?.params).toMatchObject({ tool: REMEMBER, ok: true });
  });

  it('refuses a remember call with no text, without failing the turn', async () => {
    const provider = recordingFake(
      { text: 'Hmm.', toolCall: { id: 'mem-2', name: REMEMBER, input: { kind: 'fact' } } },
      [],
    );

    const outcome = await runner(provider).run({ pet: scout, text: 'hi' }).done;

    expect(outcome.stopReason).toBe('end');
    expect(events.find((event) => event.method === 'turn.toolResult')?.params).toMatchObject({
      ok: false,
    });
  });

  it('keeps a preference the user states, privately, for the next conversation', async () => {
    const requests: BrainRequest[] = [];
    const first = runner(recordingFake({ text: 'Sure.' }, requests));
    await first.run({ pet: scout, text: 'I prefer short answers.' }).done;

    // A fresh runner and a fresh conversation: nothing carries over but the database.
    await runner(recordingFake({ text: 'ok' }, requests)).run({ pet: scout, text: 'Explain DNS' })
      .done;

    expect(requests[1]?.system).toContain('I prefer short answers.');
    expect(memories.recent('ink', 5)).toEqual([]);
  });

  it('does not file the same stated preference twice', async () => {
    const r = runner(recordingFake({ text: 'Sure.' }, []));
    await r.run({ pet: scout, text: 'I prefer short answers.' }).done;
    await r.run({ pet: scout, text: 'I prefer short answers.' }).done;

    expect(memories.recent('scout', 5)).toHaveLength(1);
  });
});

describe('the summary job after turns', () => {
  it('shrinks the history sent to the model once twenty messages have built up', async () => {
    const store = new ConversationStore(db);
    const settings = new SettingsStore(dir);
    const requests: BrainRequest[] = [];
    const provider = recordingFake({ text: 'An answer about the topic.' }, requests);
    const summarizer = new Summarizer({ store, memories, settings, provider: () => provider });
    const jobs: Promise<boolean>[] = [];
    const r = new ConversationRunner({
      store,
      settings,
      provider,
      emit: () => undefined,
      memory: memories,
      afterTurn: ({ pet, conversationId }) => jobs.push(summarizer.schedule(conversationId, pet)),
    });

    let conversationId: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const turn = r.run({ pet: scout, text: `question ${i}`, conversationId });
      conversationId = turn.conversationId;
      await turn.done;
    }
    await Promise.all(jobs);

    await r.run({ pet: scout, text: 'question 10', conversationId }).done;
    const turnRequests = requests.filter((req) => !req.system.startsWith('You condense'));

    expect(turnRequests.at(-2)?.messages).toHaveLength(19);
    expect(turnRequests.at(-1)?.messages).toHaveLength(SUMMARY_KEEP_RECENT + 1);
    expect(memories.recent('scout', 5).some((memory) => memory.kind === 'summary')).toBe(true);
    expect(turnRequests.at(-1)?.system).toContain('(summary)');
  });
});
