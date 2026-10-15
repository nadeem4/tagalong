import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextSnapshot } from '@tagalong/protocol';
import { openDatabase } from './db';
import { ConversationStore } from './store';

let dataDir: string;
let store: ConversationStore;
let close: () => void;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'tagalong-store-'));
  const db = openDatabase(dataDir);
  close = () => db.close();
  store = new ConversationStore(db);
});

afterEach(() => {
  close();
  rmSync(dataDir, { recursive: true, force: true });
});

const snapshot: ContextSnapshot = {
  id: randomUUID(),
  capturedAt: new Date().toISOString(),
  host: 'desktop',
  selection: 'the highlighted paragraph',
};

describe('ConversationStore.createConversation', () => {
  it('returns a conversation with a generated id and timestamp', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    expect(conversation.petId).toBe('scout');
    expect(conversation.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(conversation.createdAt))).toBe(false);
    expect(conversation.title).toBeNull();
  });

  it('keeps a supplied title', () => {
    expect(store.createConversation({ petId: 'scout', title: 'Debugging' }).title).toBe(
      'Debugging',
    );
  });

  it('loads a conversation back by id', () => {
    const created = store.createConversation({ petId: 'scout', title: 'Debugging' });
    expect(store.getConversation(created.id)).toEqual(created);
  });

  it('returns null for an unknown conversation', () => {
    expect(store.getConversation(randomUUID())).toBeNull();
  });
});

describe('ConversationStore.appendMessage', () => {
  it('round-trips content blocks through JSON', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    const message = store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'what is this?' }],
    });

    expect(store.listMessages(conversation.id)).toEqual([message]);
    expect(message.content).toEqual([{ type: 'text', text: 'what is this?' }]);
    expect(message.snapshot).toBeUndefined();
  });

  it('round-trips the context snapshot that produced the message', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'explain this' }],
      snapshot,
    });

    expect(store.listMessages(conversation.id)[0]?.snapshot).toEqual(snapshot);
  });

  it('rejects a message with no content blocks', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    expect(() =>
      store.appendMessage({ conversationId: conversation.id, role: 'user', content: [] }),
    ).toThrow();
  });
});

describe('ConversationStore.listMessages', () => {
  it('lists messages in the order they were appended', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    for (const text of ['one', 'two', 'three', 'four']) {
      store.appendMessage({
        conversationId: conversation.id,
        role: 'user',
        content: [{ type: 'text', text }],
      });
    }

    const texts = store
      .listMessages(conversation.id)
      .map((m) => (m.content[0]?.type === 'text' ? m.content[0].text : ''));
    expect(texts).toEqual(['one', 'two', 'three', 'four']);
  });

  it('scopes messages to their own conversation', () => {
    const mine = store.createConversation({ petId: 'scout' });
    const theirs = store.createConversation({ petId: 'scout' });
    store.appendMessage({
      conversationId: mine.id,
      role: 'user',
      content: [{ type: 'text', text: 'mine' }],
    });
    store.appendMessage({
      conversationId: theirs.id,
      role: 'user',
      content: [{ type: 'text', text: 'theirs' }],
    });

    expect(store.listMessages(mine.id)).toHaveLength(1);
    expect(store.listMessages(theirs.id)).toHaveLength(1);
  });

  it('returns an empty list for a conversation with no messages', () => {
    expect(store.listMessages(store.createConversation({ petId: 'scout' }).id)).toEqual([]);
  });
});

describe('ConversationStore.lastMessages', () => {
  it('returns the last N messages still in chronological order', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    for (const text of ['one', 'two', 'three', 'four']) {
      store.appendMessage({
        conversationId: conversation.id,
        role: 'user',
        content: [{ type: 'text', text }],
      });
    }

    const texts = store
      .lastMessages(conversation.id, 2)
      .map((m) => (m.content[0]?.type === 'text' ? m.content[0].text : ''));
    expect(texts).toEqual(['three', 'four']);
  });

  it('returns everything when fewer messages exist than requested', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    store.appendMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: [{ type: 'text', text: 'only' }],
    });
    expect(store.lastMessages(conversation.id, 20)).toHaveLength(1);
  });
});

describe('ConversationStore.purgeExpiredScreenshots', () => {
  const withShot: ContextSnapshot = {
    ...snapshot,
    screenshot: { mime: 'image/png', base64: 'iVBORw0KGgoSECRETPIXELS', width: 8, height: 8 },
  };

  function storeOne(): string {
    const conversation = store.createConversation({ petId: 'scout' });
    store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'what is this?' }],
      snapshot: withShot,
    });
    return conversation.id;
  }

  it('leaves a screenshot inside its retention window alone', () => {
    const id = storeOne();
    expect(store.purgeExpiredScreenshots({ mode: 'hours', hours: 24 })).toBe(0);
    expect(store.listMessages(id)[0]?.snapshot?.screenshot).toBeDefined();
  });

  it('strips a screenshot once its window has passed', () => {
    const id = storeOne();
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000);

    expect(store.purgeExpiredScreenshots({ mode: 'hours', hours: 1 }, later)).toBe(1);
    const message = store.listMessages(id)[0];
    expect(message?.snapshot?.screenshot).toBeUndefined();
    // The rest of the snapshot is evidence of the conversation, not of the screen.
    expect(message?.snapshot?.selection).toBe('the highlighted paragraph');
  });

  it('strips every stored screenshot when retention is switched off', () => {
    const id = storeOne();
    expect(store.purgeExpiredScreenshots({ mode: 'off' })).toBe(1);
    expect(store.listMessages(id)[0]?.snapshot?.screenshot).toBeUndefined();
  });

  it('strips a dropped image with the screenshots while retention is off, keeping its text', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'Explain this.' }],
      snapshot: {
        ...snapshot,
        dropped: {
          kind: 'image',
          name: 'chart.png',
          path: '/w/chart.png',
          image: { mime: 'image/png', base64: 'iVBORw0KGgoDROPPEDPIXELS', width: 8, height: 8 },
        },
      },
    });

    expect(store.purgeExpiredScreenshots({ mode: 'off' })).toBe(1);
    const kept = store.listMessages(conversation.id)[0]?.snapshot?.dropped;
    expect(kept?.image).toBeUndefined();
    expect(kept?.name).toBe('chart.png');
  });

  it('reports nothing purged when no row holds a screenshot', () => {
    const conversation = store.createConversation({ petId: 'scout' });
    store.appendMessage({
      conversationId: conversation.id,
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
      snapshot,
    });
    expect(store.purgeExpiredScreenshots({ mode: 'off' })).toBe(0);
  });
});
