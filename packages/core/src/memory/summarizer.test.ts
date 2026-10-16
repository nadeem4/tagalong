/** Tests for Summarizer: threshold, what is folded, model choice and failures. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import type { Pet } from '@tagalong/protocol';
import { openDatabase } from './db';
import { MemoryStore } from './memories';
import { ConversationStore } from './store';
import { SettingsStore } from '../settings/settings';
import { BrainError, FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest } from '../providers';
import { SUMMARY_KEEP_RECENT, SUMMARY_THRESHOLD, Summarizer } from './summarizer';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🔎',
  notes: 'You are Scout.',
  model: 'nvidia/nemotron-3-super-120b-a12b',
  providerId: 'nebius',
  roleId: 'companion',
  toolGrants: {},
  replyStyle: 'text',
};

let dir: string;
let db: Database;
let store: ConversationStore;
let memories: MemoryStore;
let settings: SettingsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-summarizer-'));
  db = openDatabase(dir);
  store = new ConversationStore(db);
  memories = new MemoryStore(db);
  settings = new SettingsStore(dir);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function conversationWith(messages: number): string {
  const { id } = store.createConversation({ petId: 'scout' });
  for (let i = 0; i < messages; i += 1) {
    store.appendMessage({
      conversationId: id,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: [{ type: 'text', text: `message ${i}` }],
    });
  }
  return id;
}

/** A fake brain that records which pet-shaped config asked and what it was sent. */
function brains(reply = 'The user asked about DNS; Scout explained resolvers.') {
  const asked: { providerId: string; model: string }[] = [];
  const requests: BrainRequest[] = [];
  const fake = new FakeBrainProvider({ text: reply });
  const provider: BrainProvider = {
    id: 'fake',
    capabilities: fake.capabilities,
    listModels: () => fake.listModels(),
    complete: (req, handlers, signal) => {
      requests.push(req);
      return fake.complete(req, handlers, signal);
    },
  };
  return {
    asked,
    requests,
    resolve: (pet: Pet) => {
      asked.push({ providerId: pet.providerId, model: pet.model });
      return provider;
    },
  };
}

describe('Summarizer', () => {
  it('does nothing before the conversation reaches the threshold', async () => {
    const id = conversationWith(SUMMARY_THRESHOLD - 1);
    const fake = brains();
    const summarizer = new Summarizer({ store, memories, settings, provider: fake.resolve });

    expect(await summarizer.schedule(id, scout)).toBe(false);
    expect(fake.requests).toHaveLength(0);
  });

  it('writes a summary memory and marks all but the newest messages as summarized', async () => {
    const id = conversationWith(SUMMARY_THRESHOLD);
    const fake = brains();
    const summarizer = new Summarizer({ store, memories, settings, provider: fake.resolve });

    expect(await summarizer.schedule(id, scout)).toBe(true);

    const [summary] = memories.recent('scout', 5);
    expect(summary).toMatchObject({ kind: 'summary', scope: 'pet', petId: 'scout' });
    expect(summary?.text).toContain('DNS');
    expect(store.lastMessages(id, 100)).toHaveLength(SUMMARY_KEEP_RECENT);
    expect(store.listMessages(id)).toHaveLength(SUMMARY_THRESHOLD);
    // The transcript sent to the summarizer names who said what.
    const sent = fake.requests[0]?.messages[0]?.content[0];
    expect(sent?.type === 'text' ? sent.text : '').toContain('Scout: message 1');
    expect(fake.requests[0]?.tools).toBeUndefined();
  });

  it('defaults to the pet’s own provider and model', async () => {
    const fake = brains();
    await new Summarizer({ store, memories, settings, provider: fake.resolve }).schedule(
      conversationWith(SUMMARY_THRESHOLD),
      scout,
    );

    expect(fake.asked).toEqual([{ providerId: 'nebius', model: scout.model }]);
    expect(fake.requests[0]?.model).toBe(scout.model);
  });

  it('uses the summarizer configured in settings when there is one', async () => {
    settings.set({ summarizer: { providerId: 'openrouter', model: 'anthropic/claude-haiku-4.5' } });
    const fake = brains();
    await new Summarizer({ store, memories, settings, provider: fake.resolve }).schedule(
      conversationWith(SUMMARY_THRESHOLD),
      scout,
    );

    expect(fake.asked).toEqual([{ providerId: 'openrouter', model: 'anthropic/claude-haiku-4.5' }]);
  });

  it('leaves the history alone when the summary call fails, and reports why', async () => {
    const id = conversationWith(SUMMARY_THRESHOLD);
    const errors: unknown[] = [];
    const failing: BrainProvider = {
      ...new FakeBrainProvider({ text: '' }),
      id: 'fake',
      capabilities: { vision: false, tools: false, streaming: true },
      listModels: () => Promise.resolve([]),
      complete: () => Promise.reject(new BrainError('auth', 'No key.')),
    };
    const summarizer = new Summarizer({
      store,
      memories,
      settings,
      provider: () => failing,
      onError: (error) => errors.push(error),
    });

    expect(await summarizer.schedule(id, scout)).toBe(false);
    expect(memories.recent('scout', 5)).toEqual([]);
    expect(store.lastMessages(id, 100)).toHaveLength(SUMMARY_THRESHOLD);
    expect(errors).toHaveLength(1);
  });

  it('runs one job per conversation even when scheduled twice at once', async () => {
    const id = conversationWith(SUMMARY_THRESHOLD);
    const fake = brains();
    const summarizer = new Summarizer({ store, memories, settings, provider: fake.resolve });

    await Promise.all([summarizer.schedule(id, scout), summarizer.schedule(id, scout)]);

    expect(fake.requests).toHaveLength(1);
    expect(memories.recent('scout', 5)).toHaveLength(1);
  });

  it('summarises again only after another full batch of new messages', async () => {
    const id = conversationWith(SUMMARY_THRESHOLD);
    const fake = brains();
    const summarizer = new Summarizer({ store, memories, settings, provider: fake.resolve });
    await summarizer.schedule(id, scout);

    expect(await summarizer.schedule(id, scout)).toBe(false);
    expect(fake.requests).toHaveLength(1);
  });
});
