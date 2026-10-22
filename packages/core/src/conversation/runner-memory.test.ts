/** Tests for memory in a turn: recall into the prompt, stated preferences and the summary job. */
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
import { SUMMARY_INSTRUCTIONS, SUMMARY_KEEP_RECENT, Summarizer } from '../memory/summarizer';
import { REMEMBER } from '../tools';
import { MEMORY_HEADING } from './now';
import { ConversationRunner, type TurnEvent } from './runner';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  model: 'fake-model',
  providerId: 'fake',
  roleId: 'companion',
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
      petId: 'scout',
      kind: 'preference',
      text: 'Prefers short answers',
    });
    memories.add({ petId: 'ink', kind: 'fact', text: 'Ink only knows this' });
    const requests: BrainRequest[] = [];

    await runner(recordingFake({ text: 'ok' }, requests)).run({ pet: scout, text: 'hello' }).done;

    // On the question, not in the system prompt, which stays the same every turn.
    expect(question(requests[0])).toContain(MEMORY_HEADING);
    expect(question(requests[0])).toContain('Prefers short answers');
    expect(question(requests[0])).not.toContain('Ink only knows this');
    expect(requests[0]?.system).not.toContain('Prefers short answers');
  });

  it('sends the pet’s own notes, read fresh each turn, and still answers when they fail', async () => {
    const requests: BrainRequest[] = [];
    let notes = '## Your notes\n~~~text\n### you.md\nWorks on Tagalong.\n~~~';
    const turns = new ConversationRunner({
      store: new ConversationStore(db),
      settings: new SettingsStore(dir),
      provider: recordingFake({ text: 'ok' }, requests),
      emit: (event) => events.push(event),
      notes: () => {
        if (notes === 'broken') throw new Error('disk gone');
        return notes;
      },
    });
    await turns.run({ pet: scout, text: 'hello' }).done;
    expect(question(requests[0])).toContain('Works on Tagalong.');
    expect(requests[0]?.system).not.toContain('Works on Tagalong.');
    notes = 'broken';
    const outcome = await turns.run({ pet: scout, text: 'again' }).done;
    expect(outcome.stopReason).toBe('end');
  });

  it('adds a recent job of its own that matches the question', async () => {
    const requests: BrainRequest[] = [];
    const turns = new ConversationRunner({
      store: new ConversationStore(db),
      settings: new SettingsStore(dir),
      provider: recordingFake({ text: 'ok' }, requests),
      emit: (event) => events.push(event),
      memory: memories,
      recentWork: () => [
        {
          id: '1b2c0000-0000-0000-0000-000000000000',
          task: 'summarise the launch thread',
          note: 'Friday it is.',
          finishedAt: new Date().toISOString(),
        },
      ],
    });

    await turns.run({ pet: scout, text: 'what did the launch thread say?' }).done;
    await turns.run({ pet: scout, text: 'pricing?' }).done;

    expect(question(requests[0])).toContain(
      '- (your job, today, j-1b2c) "summarise the launch thread": Friday it is.',
    );
    expect(question(requests[1])).not.toContain('your job');
  });

  it('offers the remember tool and files what the pet saves', async () => {
    const requests: BrainRequest[] = [];
    const provider = recordingFake(
      {
        text: 'Noted.',
        toolCall: {
          id: 'mem-1',
          name: REMEMBER,
          input: { text: 'Works in TypeScript', kind: 'fact' },
        },
      },
      requests,
    );

    await runner(provider).run({ pet: scout, text: 'I write TypeScript all day' }).done;

    expect(requests[0]?.tools?.map((tool) => tool.name)).toContain(REMEMBER);
    expect(memories.recent('scout', 5).map((m) => m.text)).toEqual(['Works in TypeScript']);
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

  it('files nothing by pattern: a stated preference is kept by remember or the summary', async () => {
    await runner(recordingFake({ text: 'Sure.' }, [])).run({
      pet: scout,
      text: 'I prefer short answers.',
    }).done;

    expect(memories.recent('scout', 5)).toEqual([]);
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
    const turnRequests = requests.filter((req) => !req.system.includes(SUMMARY_INSTRUCTIONS));

    expect(turnRequests.at(-2)?.messages).toHaveLength(19);
    expect(turnRequests.at(-1)?.messages).toHaveLength(SUMMARY_KEEP_RECENT + 1);
    expect(memories.recent('scout', 5).some((memory) => memory.kind === 'summary')).toBe(true);
    expect(question(turnRequests.at(-1))).toContain('(summary)');
  });
});

/** The text of a request's last user message, where memories ride. */
function question(request: BrainRequest | undefined): string {
  return (request?.messages.at(-1)?.content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n');
}
