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
import { FakeBrainProvider } from '../providers';
import type { BrainProvider, BrainRequest } from '../providers';
import { ConversationRunner, type TurnEvent } from '../conversation/runner';
import { buildHandoff, startHandoff } from './handoff';

const base = {
  avatar: '*',
  model: 'fake-model',
  providerId: 'fake',
  roleId: 'generalist',
  roleVersion: 1,
  toolGrants: {},
  replyStyle: 'text' as const,
};
const scout: Pet = { ...base, id: 'scout', name: 'Scout', notes: 'You are Scout.' };
const ink: Pet = { ...base, id: 'ink', name: 'Ink', notes: 'You are Ink.', model: 'ink-model' };

const pageSnapshot: ContextSnapshot = {
  id: randomUUID(),
  capturedAt: new Date().toISOString(),
  host: 'extension',
  page: { url: 'https://example.com/post', title: 'Launch post', text: 'We are launching.' },
  selection: 'We are launching on Friday.',
};

let dir: string;
let db: Database;
let store: ConversationStore;
let events: TurnEvent[];
let requests: BrainRequest[];
let runner: ConversationRunner;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tagalong-handoff-'));
  db = openDatabase(dir);
  store = new ConversationStore(db);
  events = [];
  requests = [];
  const fake = new FakeBrainProvider({ text: 'Here is a draft reply.' });
  const provider: BrainProvider = {
    id: 'fake',
    capabilities: fake.capabilities,
    listModels: () => fake.listModels(),
    complete: (req, handlers, signal) => {
      requests.push(req);
      return fake.complete(req, handlers, signal);
    },
  };
  runner = new ConversationRunner({
    store,
    settings: new SettingsStore(dir),
    provider,
    emit: (event) => events.push(event),
  });
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Scout explains a page: one question with the page attached, one answer. */
function scoutThread(): string {
  const { id } = store.createConversation({ petId: 'scout' });
  store.appendMessage({
    conversationId: id,
    role: 'user',
    content: [{ type: 'text', text: 'Explain this page' }],
    snapshot: pageSnapshot,
  });
  store.appendMessage({
    conversationId: id,
    role: 'assistant',
    content: [{ type: 'text', text: 'It announces a Friday launch of the new app.' }],
  });
  return id;
}

describe('buildHandoff', () => {
  it('carries a two-paragraph summary, the latest snapshot, and the request', () => {
    const conversationId = scoutThread();

    const payload = buildHandoff({
      store,
      from: scout,
      to: ink,
      conversationId,
      request: 'draft a reply to this',
    });

    expect(payload.fromPetId).toBe('scout');
    expect(payload.toPetId).toBe('ink');
    expect(payload.request).toBe('draft a reply to this');
    expect(payload.snapshot).toEqual(pageSnapshot);
    const paragraphs = payload.summary.split('\n\n');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('Explain this page');
    expect(paragraphs[0]).toContain('Launch post');
    expect(paragraphs[1]).toContain('Friday launch');
    expect(paragraphs[1]).toContain('Scout');
  });

  it('prefers the snapshot the user just attached over the thread’s older one', () => {
    const fresh: ContextSnapshot = { ...pageSnapshot, id: randomUUID(), selection: 'newer' };

    const payload = buildHandoff({
      store,
      from: scout,
      to: ink,
      conversationId: scoutThread(),
      request: 'x',
      snapshot: fresh,
    });

    expect(payload.snapshot?.selection).toBe('newer');
  });

  it('says plainly when there is no earlier thread to hand over', () => {
    const payload = buildHandoff({ store, from: scout, to: ink, request: 'hello' });

    expect(payload.summary.split('\n\n')).toHaveLength(2);
    expect(payload.summary).toContain('no earlier conversation');
    expect(payload.snapshot).toBeUndefined();
  });

  it('clips a long answer rather than forwarding all of it', () => {
    const { id } = store.createConversation({ petId: 'scout' });
    store.appendMessage({
      conversationId: id,
      role: 'user',
      content: [{ type: 'text', text: 'q' }],
    });
    store.appendMessage({
      conversationId: id,
      role: 'assistant',
      content: [{ type: 'text', text: 'z'.repeat(5000) }],
    });

    const payload = buildHandoff({ store, from: scout, to: ink, conversationId: id, request: 'r' });

    expect(payload.summary.length).toBeLessThan(1500);
    expect(payload.summary).toContain('…');
  });
});

describe('startHandoff', () => {
  it('starts the target in a new conversation with the context intact, and announces it first', async () => {
    const conversationId = scoutThread();

    const handle = startHandoff(
      { runner, store, emit: (event) => events.push(event) },
      { from: scout, to: ink, conversationId, request: 'draft a reply to this' },
    );
    const outcome = await handle.done;

    expect(handle.conversationId).not.toBe(conversationId);
    expect(store.getConversation(handle.conversationId)?.petId).toBe('ink');
    expect(outcome.text).toBe('Here is a draft reply.');

    // The bubble comes before the target starts talking, and points at its turn.
    const [first, second] = events;
    expect(first?.method).toBe('pet.message');
    expect(first?.params).toMatchObject({
      kind: 'handoff',
      fromPetId: 'scout',
      toPetId: 'ink',
      turnId: handle.turnId,
      conversationId: handle.conversationId,
    });
    expect(second).toMatchObject({
      method: 'turn.started',
      params: { petId: 'ink', model: 'ink-model', providerId: 'fake' },
    });

    // Ink's model saw the summary, the request, and the page.
    const sent = JSON.stringify(requests[0]?.messages);
    expect(requests[0]?.model).toBe('ink-model');
    expect(requests[0]?.system).toContain('You are Ink.');
    expect(sent).toContain('Scout handed this over to you');
    expect(sent).toContain('draft a reply to this');
    expect(sent).toContain('Friday launch');
    expect(sent).toContain('We are launching on Friday.');
  });
});
