/**
 * BrainClient against a fake socket and fake timers: hello, say, notifications, use,
 * cancel and reconnect, all driven by hand so no network or real clock is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool } from '@tagalong/contract';
import { BrainClient, BrainOffline, type BrainSocket, type BrainStatus } from './brain-client.js';

class FakeSocket implements BrainSocket {
  sent: Record<string, any>[] = [];
  closed = false;
  private open: (() => void) | undefined;
  private message: ((d: string) => void) | undefined;
  private close_: (() => void) | undefined;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
  onOpen(f: () => void): void {
    this.open = f;
  }
  onMessage(f: (d: string) => void): void {
    this.message = f;
  }
  onClose(f: () => void): void {
    this.close_ = f;
  }
  opens(): void {
    this.open?.();
  }
  receive(msg: unknown): void {
    this.message?.(JSON.stringify(msg));
  }
  drop(): void {
    this.close_?.();
  }
}

const tools: Tool[] = [{ name: 'see_screen', description: 'look', input_schema: {} }];
const helloOk = (id: string, resync = false) => ({
  jsonrpc: '2.0',
  id,
  result: { protocol: 1, session: 's1', tools: [], seq: 0, resync },
});

function setup(retryMs?: number) {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const statuses: BrainStatus[] = [];
  const notes: [string, unknown][] = [];
  const onUse = vi.fn(async () => [{ type: 'text' as const, text: 'ok' }]);
  const client = new BrainClient({
    addr: '127.0.0.1:47321',
    tools: () => tools,
    openSocket: (url) => {
      urls.push(url);
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    onNotification: (m, p) => notes.push([m, p]),
    onUse,
    onStatus: (s) => statuses.push(s),
    ...(retryMs === undefined ? {} : { retryMs }),
  });
  return { client, sockets, urls, statuses, notes, onUse };
}

async function online(retryMs?: number) {
  const ctx = setup(retryMs);
  ctx.client.start();
  const s = ctx.sockets[0]!;
  s.opens();
  s.receive(helloOk(s.sent[0]!.id));
  await vi.advanceTimersByTimeAsync(0);
  return { ...ctx, s };
}

const turn = (seq: number) => ({
  jsonrpc: '2.0',
  method: 'turn',
  params: { seq, turn: 't1', body: 'desktop', state: 'started' },
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('BrainClient', () => {
  it('sends hello first with protocol 1, body desktop, tools from options, no last_seq on first connect', () => {
    const { client, sockets, urls, statuses } = setup();
    client.start();
    expect(urls).toEqual(['ws://127.0.0.1:47321']);
    expect(statuses).toEqual(['connecting']);
    sockets[0]!.opens();
    expect(sockets[0]!.sent).toEqual([
      {
        jsonrpc: '2.0',
        id: 'desktop-1',
        method: 'hello',
        params: { protocol: 1, body: { id: 'desktop', kind: 'desktop', name: 'Desktop' }, tools },
      },
    ]);
  });

  it('goes online and keeps the session once hello resolves', async () => {
    const { client, statuses } = await online();
    expect(statuses).toEqual(['connecting', 'online']);
    expect(client.session).toBe('s1');
  });

  it('say resolves with the SayResult for its id', async () => {
    const { client, s } = await online();
    const p = client.say({ text: 'hi' });
    const req = s.sent[1]!;
    expect(req).toMatchObject({ method: 'say', params: { text: 'hi' } });
    s.receive({ jsonrpc: '2.0', id: req.id, result: { turn: 't1', joined: false } });
    await expect(p).resolves.toEqual({ turn: 't1', joined: false });
  });

  it('say rejects BrainOffline before hello resolves', async () => {
    const { client, sockets } = setup();
    client.start();
    sockets[0]!.opens();
    await expect(client.say({ text: 'hi' })).rejects.toBeInstanceOf(BrainOffline);
  });

  it('say rejects with a plain Error when the brain answers with an error', async () => {
    const { client, s } = await online();
    const p = client.say({ text: 'hi' });
    s.receive({ jsonrpc: '2.0', id: s.sent[1]!.id, error: { code: -32602, message: 'bad' } });
    const e = await p.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(BrainOffline);
  });

  it('say times out after 30 s with a plain Error', async () => {
    const { client } = await online();
    const p = client.say({ text: 'hi' });
    const caught = p.catch((x: unknown) => x);
    await vi.advanceTimersByTimeAsync(30_000);
    const e = await caught;
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(BrainOffline);
  });

  it('notifications are passed on in seq order and remembered as last_seq', async () => {
    const { s, notes, sockets } = await online(100);
    s.receive(turn(1));
    s.receive(turn(2));
    expect(notes.map(([m, p]) => [m, (p as { seq: number }).seq])).toEqual([
      ['turn', 1],
      ['turn', 2],
    ]);
    s.drop();
    vi.advanceTimersByTime(100);
    const s2 = sockets[1]!;
    s2.opens();
    expect(s2.sent[0]!.params.last_seq).toBe(2);
  });

  it('drops a notification that fails its zod schema without throwing', async () => {
    const { s, notes } = await online();
    expect(() =>
      s.receive({ jsonrpc: '2.0', method: 'turn', params: { seq: 'x', turn: 1 } }),
    ).not.toThrow();
    expect(() => s.receive('not an object')).not.toThrow();
    expect(notes).toEqual([]);
  });

  it('version_mismatch on hello: status outdated, no retry', async () => {
    const { sockets, statuses, client } = setup(100);
    client.start();
    const s = sockets[0]!;
    s.opens();
    s.receive({
      jsonrpc: '2.0',
      id: s.sent[0]!.id,
      error: { code: -32000, message: 'protocol', data: { protocol: 2 } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe('outdated');
    s.drop();
    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe('outdated');
  });

  it('socket close: pending say rejects BrainOffline, status offline, retries after retryMs', async () => {
    const { client, s, sockets, statuses } = await online(500);
    const p = client.say({ text: 'hi' });
    s.drop();
    await expect(p).rejects.toBeInstanceOf(BrainOffline);
    expect(statuses.at(-1)).toBe('offline');
    vi.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    expect(statuses.at(-1)).toBe('connecting');
  });

  it('retries after a connect that never opened', () => {
    const { client, sockets } = setup(500);
    client.start();
    sockets[0]!.drop();
    vi.advanceTimersByTime(500);
    expect(sockets).toHaveLength(2);
  });

  it('stop closes the socket and does not retry', async () => {
    const { client, s, sockets } = await online(100);
    client.stop();
    expect(s.closed).toBe(true);
    s.drop();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(1);
  });

  it('use: calls onUse with tool, input, call and answers {output}', async () => {
    const { s, onUse } = await online();
    s.receive({
      jsonrpc: '2.0',
      id: 'b1',
      method: 'use',
      params: { call: 'c1', tool: 'see_screen', input: { a: 1 } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUse).toHaveBeenCalledWith('see_screen', { a: 1 }, 'c1');
    expect(s.sent.at(-1)).toEqual({
      jsonrpc: '2.0',
      id: 'b1',
      result: { output: [{ type: 'text', text: 'ok' }] },
    });
  });

  it('onUse throws → error tool_failed (-32007)', async () => {
    const { s, onUse } = await online();
    onUse.mockRejectedValueOnce(new Error('boom'));
    s.receive({
      jsonrpc: '2.0',
      id: 'b1',
      method: 'use',
      params: { call: 'c1', tool: 'see_screen', input: {} },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.sent.at(-1)).toMatchObject({ id: 'b1', error: { code: -32007 } });
  });

  it('use for an undeclared tool → unknown_tool (-32001)', async () => {
    const { s, onUse } = await online();
    s.receive({
      jsonrpc: '2.0',
      id: 'b1',
      method: 'use',
      params: { call: 'c1', tool: 'nope', input: {} },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onUse).not.toHaveBeenCalled();
    expect(s.sent.at(-1)).toMatchObject({ id: 'b1', error: { code: -32001 } });
  });

  it('use with bad params → invalid_params (-32602)', async () => {
    const { s } = await online();
    s.receive({ jsonrpc: '2.0', id: 'b1', method: 'use', params: { tool: 1 } });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.sent.at(-1)).toMatchObject({ id: 'b1', error: { code: -32602 } });
  });

  it('cancel notification from brain (params.call) is ignored without error', async () => {
    const { s, notes } = await online();
    const before = s.sent.length;
    expect(() =>
      s.receive({ jsonrpc: '2.0', method: 'cancel', params: { call: 'c1' } }),
    ).not.toThrow();
    expect(notes).toEqual([]);
    expect(s.sent).toHaveLength(before);
  });

  it('cancel(turn) sends {method:"cancel", params:{turn}}', async () => {
    const { client, s } = await online();
    client.cancel('t1');
    expect(s.sent.at(-1)).toEqual({ jsonrpc: '2.0', method: 'cancel', params: { turn: 't1' } });
  });

  it('cancel(turn) is a no-op when offline', async () => {
    const { client, s } = await online();
    s.drop();
    const before = s.sent.length;
    client.cancel('t1');
    expect(s.sent).toHaveLength(before);
  });
});
