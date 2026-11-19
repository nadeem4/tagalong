/** Tests for the chat sync: the anchor refresh, and the catch-up after a resync that pages and retries. */
import { describe, expect, it } from 'vitest';
import { createChatSync } from './chat-sync.js';
import { createTurnEvents } from './turn-events.js';

type Row = { id: string; role: string; text: string; body: string };
const row = (id: number, text = `m${id}`): Row => ({
  id: String(id),
  role: 'assistant',
  text,
  body: 'desktop',
});

function rig(chat: Row[]) {
  const calls: Record<string, unknown>[] = [];
  const shown: string[] = [];
  let fail = false;
  const events = createTurnEvents(() => 'pet');
  const sync = createChatSync({
    call: async (_tool, input) => {
      calls.push(input);
      if (fail) throw new Error('timed out');
      const after = Number(input.after_id ?? 0);
      const limit = Number(input.limit ?? 20);
      const rest = chat.filter((r) => Number(r.id) > after);
      const messages = input.after_id === undefined ? rest.slice(-limit) : rest.slice(0, limit);
      return { messages, more: input.after_id !== undefined && rest.length > messages.length };
    },
    events,
    forward: (e) => {
      if (e.type === 'pet.remark') shown.push(e.text);
    },
  });
  return { sync, calls, shown, setFail: (v: boolean) => (fail = v) };
}

describe('createChatSync', () => {
  it('refreshes the anchor to the newest saved id', async () => {
    const r = rig([row(1), row(2)]);
    await r.sync.online();
    expect(r.calls).toEqual([{ limit: 1 }]);
    expect(r.shown).toEqual([]);
  });

  it('a second resync asks after the anchor, so nothing is lost or repeated', async () => {
    const chat = [row(1)];
    const r = rig(chat);
    await r.sync.online();
    chat.push(row(2, 'first missed'));
    r.sync.resynced();
    await r.sync.online();
    chat.push(row(3, 'second missed'));
    r.sync.resynced();
    await r.sync.online();
    expect(r.shown).toEqual(['first missed', 'second missed']);
    expect(r.calls.at(-1)).toEqual({ after_id: '2' });
  });

  it('pages while more is true', async () => {
    const chat = [row(1)];
    const r = rig(chat);
    await r.sync.online();
    for (let i = 2; i <= 26; i += 1) chat.push(row(i));
    r.sync.resynced();
    await r.sync.online();
    expect(r.shown).toHaveLength(25);
    expect(r.calls.slice(1)).toEqual([{ after_id: '1' }, { after_id: '21' }]);
  });

  it('a reply saved just before the drop is noticed when its turn end was not', async () => {
    const chat = [row(1)];
    const r = rig(chat);
    await r.sync.online();
    chat.push(row(2, 'finished as the link fell'));
    r.sync.resynced();
    await r.sync.online();
    expect(r.shown).toEqual(['finished as the link fell']);
  });

  it('a turn shown live is not shown again by the catch-up', async () => {
    const chat = [row(1)];
    const r = rig(chat);
    await r.sync.online();
    chat.push(row(2, 'streamed live'));
    await r.sync.turnEnded();
    r.sync.resynced();
    await r.sync.online();
    expect(r.shown).toEqual([]);
  });

  it('a failed catch-up is retried on the next online', async () => {
    const chat = [row(1)];
    const r = rig(chat);
    await r.sync.online();
    chat.push(row(2, 'missed'));
    r.sync.resynced();
    r.setFail(true);
    await r.sync.online();
    expect(r.shown).toEqual([]);
    r.setFail(false);
    await r.sync.online();
    expect(r.shown).toEqual(['missed']);
  });
});
