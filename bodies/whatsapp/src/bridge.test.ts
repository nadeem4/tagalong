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
  /** When false the socket never opens, like a brain that is down. */
  constructor(private readonly up = true) {}

  socket = (): BrainSocket => ({
    send: (data) => {
      const msg = JSON.parse(data);
      this.sent.push(msg);
      if (msg.method === 'hello') {
        this.respond(msg.id, { protocol: 1, session: 's1', tools: [], seq: 1, resync: false });
      } else if (msg.method === 'say') {
        this.respond(msg.id, { turn: 't1', joined: false });
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
    onClose: () => undefined,
  });

  private respond(id: string, result: unknown) {
    this.onMessage(JSON.stringify({ jsonrpc: '2.0', id, result }));
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
  const bodies: { to: string; text: { body: string } }[] = [];
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
  const inbound = async (text: string, id = `m${Math.random()}`) => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                messages: [{ id, from: CONFIG.allowedNumber, type: 'text', text: { body: text } }],
              },
            },
          ],
        },
      ],
    });
    const sig = `sha256=${createHmac('sha256', CONFIG.appSecret).update(body).digest('hex')}`;
    await fetch(`${base}/webhook`, {
      method: 'POST',
      headers: { 'x-hub-signature-256': sig },
      body,
    });
  };
  return { brain, graph, logs, inbound };
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
