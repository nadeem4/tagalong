/**
 * Tests for the bridge as a contract v1 body, on a fake brain socket, a fake Graph fetch,
 * a movable clock and signed local webhook posts. No Meta, no brain, no network.
 */
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { BrainSocket } from '@tagalong/contract';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createBridge } from './bridge';
import type { WhatsAppConfig } from './config';

const CONFIG: WhatsAppConfig = {
  brainAddr: '127.0.0.1:1',
  accessToken: 'tok',
  appSecret: 'app-secret',
  verifyToken: 'v',
  phoneNumberId: '99',
  allowedNumber: '15550001111',
  port: 0,
};

class FakeBrain {
  sent: { id?: string; method: string; params: Record<string, unknown> }[] = [];
  private onMessage: (d: string) => void = () => undefined;
  private onOpenCb: () => void = () => undefined;
  private onCloseCb: () => void = () => undefined;
  private resyncNext = false;
  /** Set to make the next `answer` fail like an ask the brain no longer holds. */
  answerGone = false;
  /** When false the socket never opens, like a brain that is down. */
  constructor(private readonly up = true) {}

  socket = (): BrainSocket => ({
    send: (data) => {
      const msg = JSON.parse(data);
      this.sent.push(msg);
      if (msg.method === 'hello') {
        const resync = this.resyncNext;
        this.resyncNext = false;
        this.respond(msg.id, { protocol: 1, session: 's1', tools: [], seq: this.seq, resync });
      } else if (msg.method === 'say') {
        this.respond(msg.id, { turn: 't1', joined: false });
      } else if (msg.method === 'answer') {
        if (this.answerGone) {
          this.onMessage(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              error: { code: -32002, message: 'gone' },
            }),
          );
        } else this.respond(msg.id, {});
      }
    },
    close: () => undefined,
    onOpen: (f) => {
      this.onOpenCb = f;
      if (this.up) queueMicrotask(() => this.onOpenCb());
    },
    onMessage: (f) => {
      this.onMessage = f;
    },
    onClose: (f) => {
      this.onCloseCb = f;
    },
  });

  private respond(id: string, result: unknown) {
    this.onMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
  }

  /** Drops the socket; the client reconnects and the brain answers hello with resync. */
  dropAndResync() {
    this.resyncNext = true;
    this.onCloseCb();
  }

  ask(id: string, options = ['allow', 'deny'], extra: Record<string, unknown> = {}) {
    this.onMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'ask',
        params: { seq: ++this.seq, id, state: 'open', text: `Question ${id}?`, options, ...extra },
      }),
    );
  }

  closeAsk(id: string) {
    this.onMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'ask',
        params: { seq: ++this.seq, id, state: 'closed', reason: 'answered' },
      }),
    );
  }

  answers() {
    return this.sent.filter((m) => m.method === 'answer').map((m) => m.params);
  }

  private seq = 1;
  reply(body: string | null, fields: { delta: string } | { done: true }, turn = 't1') {
    this.onMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'reply',
        params: { seq: ++this.seq, turn, body, ...fields },
      }),
    );
  }

  says() {
    return this.sent.filter((m) => m.method === 'say');
  }
}

function fakeFetch() {
  const bodies: {
    to: string;
    type: string;
    text: { body: string };
    interactive?: { body: { text: string }; action: { buttons: { reply: { id: string } }[] } };
  }[] = [];
  const fn = (async (_url: string | URL | Request, init?: RequestInit) => {
    // A slow first send would let a second turn's parts slip in between.
    await new Promise((r) => setTimeout(r, bodies.length === 0 ? 30 : 0));
    bodies.push(JSON.parse(String(init?.body)));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { fn, bodies };
}

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((c) => c()));
});

async function setup(options: { brain?: FakeBrain; now?: () => number } = {}) {
  const brain = options.brain ?? new FakeBrain();
  const graph = fakeFetch();
  const logs: string[] = [];
  const bridge = createBridge({
    config: CONFIG,
    openSocket: brain.socket,
    fetch: graph.fn,
    ...(options.now ? { now: options.now } : {}),
    log: (l) => logs.push(l),
  });
  await new Promise<void>((r) => bridge.webhook.listen(0, '127.0.0.1', r));
  await bridge.start();
  closers.push(async () => {
    await bridge.stop();
    await new Promise((r) => bridge.webhook.close(r));
  });
  const base = `http://127.0.0.1:${(bridge.webhook.address() as AddressInfo).port}`;
  const post = async (message: Record<string, unknown>) => {
    const body = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ from: CONFIG.allowedNumber, ...message }] } }] }],
    });
    const sig = `sha256=${createHmac('sha256', CONFIG.appSecret).update(body).digest('hex')}`;
    await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'x-hub-signature-256': sig },
      body,
    });
  };
  const inbound = (text: string, id = `m${Math.random()}`) =>
    post({ id, type: 'text', text: { body: text } });
  const tap = (buttonId: string, id = `m${Math.random()}`) =>
    post({
      id,
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'x' } },
    });
  return { brain, graph, logs, inbound, tap };
}

const online = (brain: FakeBrain) => vi.waitFor(() => expect(brain.sent.length).toBeGreaterThan(0));

describe('bridge', () => {
  test('test_hello_declares_the_whatsapp_body_with_no_tools_and_no_display', async () => {
    const { brain } = await setup();
    await online(brain);
    const hello = brain.sent.find((m) => m.method === 'hello');
    expect(hello?.params).toEqual({
      protocol: 1,
      body: { id: 'whatsapp', kind: 'whatsapp', name: 'WhatsApp' },
      tools: [],
    });
  });

  test('test_an_allowed_text_becomes_a_say_with_the_phone_context', async () => {
    const { brain, inbound } = await setup();
    await online(brain);
    await vi.waitFor(() => expect(brain.sent.some((m) => m.method === 'hello')).toBe(true));
    await inbound('what is on my plate');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(1));
    expect(brain.says()[0]?.params).toEqual({
      text: 'what is on my plate',
      context: {
        channel: 'whatsapp',
        note: 'text chat on a phone; keep replies short and offer detail on request',
      },
    });
  });

  test('test_reply_is_buffered_until_done_then_sent_once', async () => {
    const { brain, graph, inbound } = await setup();
    await online(brain);
    await inbound('hi');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(1));
    brain.reply('whatsapp', { delta: 'Hello ' });
    brain.reply('whatsapp', { delta: 'there' });
    await new Promise((r) => setTimeout(r, 20));
    expect(graph.bodies).toEqual([]);
    brain.reply('whatsapp', { done: true });
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    expect(graph.bodies[0]).toMatchObject({
      to: CONFIG.allowedNumber,
      text: { body: 'Hello there' },
    });
  });

  test('test_a_huge_reply_sends_four_messages_and_the_note', async () => {
    const { brain, graph, inbound } = await setup();
    await online(brain);
    await inbound('hi');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(1));
    brain.reply('whatsapp', {
      delta: Array.from({ length: 6 }, () => 'z'.repeat(3500)).join('\n\n'),
    });
    brain.reply('whatsapp', { done: true });
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(4));
    await new Promise((r) => setTimeout(r, 30));
    expect(graph.bodies).toHaveLength(4);
    const last = graph.bodies[3]?.text.body ?? '';
    expect(last.endsWith('\n(cut: ask me for the rest)')).toBe(true);
    for (const b of graph.bodies) expect(b.text.body.length).toBeLessThanOrEqual(4000);
  });

  test('test_a_long_reply_is_sent_as_ordered_parts', async () => {
    const { brain, graph, inbound } = await setup();
    await online(brain);
    await inbound('hi');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(1));
    const first = 'a'.repeat(3000);
    const second = 'b'.repeat(3000);
    brain.reply('whatsapp', { delta: `${first}\n\n${second}` });
    brain.reply('whatsapp', { done: true });
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(2));
    expect(graph.bodies.map((b) => b.text.body)).toEqual([first, second]);
  });

  test('test_parts_of_two_turns_never_interleave', async () => {
    const { brain, graph, inbound } = await setup();
    await online(brain);
    await inbound('hi');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(1));
    const a = ['a'.repeat(3000), 'b'.repeat(3000)];
    brain.reply('whatsapp', { delta: a.join('\n\n') }, 't1');
    brain.reply('whatsapp', { delta: 'second turn' }, 't2');
    brain.reply('whatsapp', { done: true }, 't1');
    brain.reply('whatsapp', { done: true }, 't2');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(3));
    expect(graph.bodies.map((b) => b.text.body)).toEqual([...a, 'second turn']);
  });

  test('test_replies_for_other_bodies_are_not_sent', async () => {
    const { brain, graph, inbound } = await setup();
    await online(brain);
    await inbound('hi');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(1));
    brain.reply('desktop', { delta: 'for the desk' });
    brain.reply('desktop', { done: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(graph.bodies).toEqual([]);
  });

  test('test_reply_after_the_window_is_dropped', async () => {
    let now = 0;
    const { brain, graph, logs, inbound } = await setup({ now: () => now });
    await online(brain);
    await inbound('hi');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(1));
    brain.reply('whatsapp', { delta: 'late answer' });
    now = 25 * 3_600_000;
    brain.reply('whatsapp', { done: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(graph.bodies).toEqual([]);
    expect(logs.filter((l) => l.includes('24'))).toHaveLength(1);
  });

  test('test_a_say_while_the_brain_is_down_sends_nothing_to_the_phone', async () => {
    const { brain, graph, logs, inbound } = await setup({ brain: new FakeBrain(false) });
    await inbound('hi');
    await vi.waitFor(() => expect(logs.length).toBeGreaterThan(0));
    expect(brain.says()).toEqual([]);
    expect(graph.bodies).toEqual([]);
  });
});

const CLOSED = 'That question is closed.';
const MANY = 'More than one question is open: please tap a button';
const settle = () => new Promise((r) => setTimeout(r, 30));

/** A bridge whose window is open (the person has just said hi). */
async function ready(options: { now?: () => number } = {}) {
  const s = await setup(options);
  await online(s.brain);
  await s.inbound('hi');
  await vi.waitFor(() => expect(s.brain.says()).toHaveLength(1));
  return s;
}

describe('asks', () => {
  test('test_an_open_ask_is_sent_as_buttons', async () => {
    const { brain, graph } = await ready();
    brain.ask('a1', ['allow', 'always', 'deny']);
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    const sent = graph.bodies[0];
    expect(sent?.type).toBe('interactive');
    expect(sent?.interactive?.body.text).toBe('Question a1?');
    expect(sent?.interactive?.action.buttons.map((b) => b.reply.id)).toEqual([
      'ask:a1:0',
      'ask:a1:1',
      'ask:a1:2',
    ]);
  });

  test('test_a_wide_ask_is_sent_as_numbered_text', async () => {
    const { brain, graph } = await ready();
    brain.ask('a1', ['one', 'two', 'three', 'four']);
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    expect(graph.bodies[0]?.text.body).toBe('Question a1?\n\n1. one\n2. two\n3. three\n4. four');
  });

  test('test_an_ask_outside_the_window_is_not_sent', async () => {
    const { brain, graph } = await setup();
    await online(brain);
    brain.ask('a1');
    await settle();
    expect(graph.bodies).toEqual([]);
  });

  test('test_a_tap_answers_the_ask_with_the_option_word', async () => {
    const { brain, tap } = await ready();
    brain.ask('a1');
    await tap('ask:a1:1');
    await vi.waitFor(() => expect(brain.answers()).toEqual([{ ask: 'a1', option: 'deny' }]));
  });

  test('test_text_yes_answers_the_one_open_ask', async () => {
    const { brain, graph, inbound } = await ready();
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    await inbound('Yes');
    await vi.waitFor(() => expect(brain.answers()).toEqual([{ ask: 'a1', option: 'allow' }]));
    expect(brain.says()).toHaveLength(1);
  });

  test('test_free_text_reply_answers_with_the_text', async () => {
    const { brain, graph, inbound } = await ready();
    brain.ask('q1', ['reply'], { free_text: true });
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    await inbound('the blue one');
    await vi.waitFor(() =>
      expect(brain.answers()).toEqual([{ ask: 'q1', option: 'reply', text: 'the blue one' }]),
    );
  });

  test('test_text_with_two_open_asks_says_tap_a_button', async () => {
    const { brain, graph, inbound } = await ready();
    brain.ask('a1');
    brain.ask('a2');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(2));
    await inbound('yes');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(3));
    expect(graph.bodies[2]?.text.body).toBe(MANY);
    expect(brain.answers()).toEqual([]);
    expect(brain.says()).toHaveLength(1);
  });

  test('test_tap_on_a_closed_ask_says_it_is_closed', async () => {
    const { brain, graph, tap } = await ready();
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    brain.closeAsk('a1');
    await tap('ask:a1:0');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(2));
    expect(graph.bodies[1]?.text.body).toBe(CLOSED);
    expect(brain.answers()).toEqual([]);
  });

  test('test_tap_on_an_unknown_ask_says_it_is_closed', async () => {
    const { graph, tap } = await ready();
    await tap('ask:nope:0');
    await vi.waitFor(() => expect(graph.bodies.map((b) => b.text.body)).toEqual([CLOSED]));
  });

  test('test_a_not_found_answer_says_it_is_closed', async () => {
    const { brain, graph, tap } = await ready();
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    brain.answerGone = true;
    await tap('ask:a1:0');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(2));
    expect(graph.bodies[1]?.text.body).toBe(CLOSED);
  });

  test('test_text_with_no_ask_open_is_a_say', async () => {
    const { brain, inbound } = await ready();
    await inbound('yes');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(2));
    expect(brain.says()[1]?.params).toMatchObject({ text: 'yes' });
    expect(brain.answers()).toEqual([]);
  });

  test('test_text_that_is_not_an_answer_is_a_say', async () => {
    const { brain, graph, inbound } = await ready();
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    await inbound('7');
    await inbound('actually, what is the weather');
    await vi.waitFor(() => expect(brain.says()).toHaveLength(3));
    expect(brain.answers()).toEqual([]);
  });

  test('test_closed_frame_forgets_the_ask_and_sends_nothing', async () => {
    const { brain, graph } = await ready();
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    brain.closeAsk('a1');
    await settle();
    expect(graph.bodies).toHaveLength(1);
  });

  test('test_resync_clears_the_desk_and_the_resent_ask_is_shown_once', async () => {
    const { brain, graph } = await ready();
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    brain.dropAndResync();
    await vi.waitFor(() => expect(brain.sent.filter((m) => m.method === 'hello')).toHaveLength(2), {
      timeout: 5000,
    });
    brain.ask('a1');
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(2));
    await settle();
    expect(graph.bodies).toHaveLength(2);
  });

  test('test_a_late_tap_on_a_parked_ask_is_sent_to_the_brain', async () => {
    let now = 0;
    const { brain, graph, tap } = await ready({ now: () => now });
    brain.ask('a1');
    await vi.waitFor(() => expect(graph.bodies).toHaveLength(1));
    now = 30 * 3_600_000;
    await tap('ask:a1:0');
    await vi.waitFor(() => expect(brain.answers()).toEqual([{ ask: 'a1', option: 'allow' }]));
  });
});
