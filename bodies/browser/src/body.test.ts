/**
 * Tests for the browser body: hello, tools, restart, stop and keepalive.
 * They run the body on fake storage, tabs and sockets, so no real Chrome
 * or brain is needed and every case is fast and repeatable.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionBroker } from './permissions';
import { createBody, type BodyDeps } from './body';
import { FakeBrainSocket, memoryStorage, settle } from './test-support/fake-brain-socket';

const CHROME = { brands: ['Chromium', 'Google Chrome'], userAgent: 'Mozilla/5.0 Chrome/130' };

function setup(overrides: Partial<BodyDeps> = {}) {
  const sockets: FakeBrainSocket[] = [];
  const deps: BodyDeps = {
    storage: memoryStorage(),
    session: memoryStorage(),
    ...CHROME,
    tabs: {
      list: () =>
        Promise.resolve([
          {
            id: 1,
            windowId: 1,
            title: 'A',
            url: 'https://a.test/',
            active: true,
            discarded: false,
          },
        ]),
      get: () => Promise.resolve(null),
      activeInFocusedWindow: () => Promise.resolve(null),
    },
    page: {
      read: () => Promise.reject(new Error('unused')),
      parts: () => Promise.reject(new Error('unused')),
    },
    picture: { capture: () => Promise.reject(new Error('unused')) },
    search: {
      history: () => Promise.reject(new Error('unused')),
      bookmarks: () => Promise.reject(new Error('unused')),
      readingList: () => Promise.reject(new Error('unused')),
      downloads: () => Promise.reject(new Error('unused')),
      closedTabs: () => Promise.reject(new Error('unused')),
    },
    actions: {
      open: () => Promise.reject(new Error('unused')),
      search: () => Promise.reject(new Error('unused')),
      close: () => Promise.reject(new Error('unused')),
      switchTo: () => Promise.reject(new Error('unused')),
      group: () => Promise.reject(new Error('unused')),
      reopen: () => Promise.reject(new Error('unused')),
      bookmark: () => Promise.reject(new Error('unused')),
      addToReadingList: () => Promise.reject(new Error('unused')),
    },
    broker: { ensure: () => Promise.resolve() } as unknown as PermissionBroker,
    random: () => 'ab12',
    openSocket: (url) => {
      const s = new FakeBrainSocket(url);
      sockets.push(s);
      return s;
    },
    ...overrides,
  };
  return { body: createBody(deps), sockets, deps };
}

async function online(s: FakeBrainSocket): Promise<void> {
  s.open();
  await settle();
  s.acceptHello();
}

afterEach(() => vi.useRealTimers());

describe('the browser body', () => {
  it('hello_carries_a_browser_body_and_the_tabs_tool', async () => {
    const { body, sockets } = setup();
    await body.start();
    sockets[0]!.open();
    await settle();
    const params = sockets[0]!.request('hello')?.['params'] as {
      body: { id: string; kind: string; name: string };
      tools: { name: string }[];
    };
    expect(params.body.id).toBe('chrome-ab12');
    expect(params.body.kind).toBe('browser');
    expect(params.body.name).toBe('Chrome');
    expect(params.tools.map((t) => t.name)).toContain('tabs');
  });

  it('the_popup_name_overrides_the_default_name', async () => {
    const { body, sockets } = setup({ storage: memoryStorage({ bodyName: 'Work Chrome' }) });
    await body.start();
    sockets[0]!.open();
    await settle();
    const params = sockets[0]!.request('hello')?.['params'] as { body: { name: string } };
    expect(params.body.name).toBe('Work Chrome');
  });

  it('a_second_install_gets_another_id', async () => {
    const a = setup({ random: () => 'aaaa' });
    const b = setup({ random: () => 'bbbb' });
    await a.body.start();
    await b.body.start();
    expect(a.body.info().id).not.toBe(b.body.info().id);
  });

  it('the_id_survives_a_restart', async () => {
    const storage = memoryStorage();
    const first = setup({ storage, random: () => 'aaaa' });
    await first.body.start();
    const second = setup({ storage, random: () => 'bbbb' });
    await second.body.start();
    expect(second.body.info().id).toBe(first.body.info().id);
  });

  it('two_starts_at_once_make_one_id', async () => {
    const { body, sockets } = setup();
    await Promise.all([body.start(), body.start()]);
    expect(sockets).toHaveLength(1);
  });

  it('a_use_for_tabs_list_gets_its_output', async () => {
    const { body, sockets } = setup();
    await body.start();
    await online(sockets[0]!);
    sockets[0]!.receive({
      jsonrpc: '2.0',
      id: 'u1',
      method: 'use',
      params: { call: 'c1', tool: 'tabs', input: { action: 'list' } },
    });
    await settle();
    const reply = sockets[0]!.sent.find((m) => m['id'] === 'u1') as {
      result: { output: { text: string }[] };
    };
    expect(JSON.parse(reply.result.output[0]!.text).tabs[0].url).toBe('https://a.test/');
  });

  it('tab_changes_reach_the_brain_as_event_frames', async () => {
    const { body, sockets } = setup();
    await body.start();
    await online(sockets[0]!);
    body.tabChanged({ title: 'Docs', url: 'https://a.test/docs?q=1' });
    expect(sockets[0]!.request('event')?.['params']).toEqual({
      name: 'tab',
      data: { title: 'Docs', url: 'https://a.test/docs' },
    });
  });

  it('downloads_reach_the_brain_as_event_frames', async () => {
    const { body, sockets } = setup();
    await body.start();
    await online(sockets[0]!);
    body.downloadChanged({ filename: 'C:\\Users\\a\\Downloads\\tax.pdf', state: 'complete' });
    expect(sockets[0]!.request('event')?.['params']).toEqual({
      name: 'download',
      data: { name: 'tax.pdf', state: 'complete' },
    });
  });

  it('events_are_not_sent_while_offline', async () => {
    const { body, sockets } = setup();
    await body.start();
    body.tabChanged({ title: 'Docs', url: 'https://a.test/docs' });
    body.downloadChanged({ filename: 'tax.pdf', state: 'complete' });
    expect(sockets[0]!.request('event')).toBeUndefined();
  });

  it('an_unknown_tool_is_unknown_tool', async () => {
    const { body, sockets } = setup();
    await body.start();
    await online(sockets[0]!);
    sockets[0]!.receive({
      jsonrpc: '2.0',
      id: 'u2',
      method: 'use',
      params: { call: 'c2', tool: 'nope', input: {} },
    });
    await settle();
    const reply = sockets[0]!.sent.find((m) => m['id'] === 'u2') as { error: { message: string } };
    expect(reply.error.message).toBe('unknown tool');
  });

  it('last_seq_is_read_from_session_storage_on_start', async () => {
    const { body, sockets } = setup({ session: memoryStorage({ lastSeq: 9 }) });
    await body.start();
    sockets[0]!.open();
    await settle();
    const params = sockets[0]!.request('hello')?.['params'] as { last_seq?: number };
    expect(params.last_seq).toBe(9);
  });

  it('restart_dials_the_new_address', async () => {
    const storage = memoryStorage();
    const { body, sockets } = setup({ storage });
    await body.start();
    expect(sockets[0]!.url).toBe('ws://127.0.0.1:47321');
    await storage.set('brainAddr', '192.168.1.5:9000');
    await body.restart();
    expect(sockets[0]!.closed).toBe(true);
    expect(sockets[1]!.url).toBe('ws://192.168.1.5:9000');
  });

  it('keepalive_calls_spend_today_every_20s_while_online', async () => {
    vi.useFakeTimers();
    const { body, sockets } = setup();
    await body.start();
    await online(sockets[0]!);
    expect(body.info().status).toBe('online');
    vi.advanceTimersByTime(20_000);
    const call = sockets[0]!.request('call')?.['params'] as { tool: string };
    expect(call.tool).toBe('spend_today');
  });

  it('stop_closes_the_socket_and_ends_the_keepalive', async () => {
    vi.useFakeTimers();
    const { body, sockets } = setup();
    await body.start();
    await online(sockets[0]!);
    body.stop();
    expect(sockets[0]!.closed).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(sockets[0]!.request('call')).toBeUndefined();
  });

  it('brain_notifications_other_than_use_are_ignored', async () => {
    const { body, sockets } = setup();
    await body.start();
    await online(sockets[0]!);
    const before = sockets[0]!.sent.length;
    sockets[0]!.receive({ jsonrpc: '2.0', method: 'ask', params: { seq: 1 } });
    sockets[0]!.receive({ jsonrpc: '2.0', method: 'reply', params: { seq: 2 } });
    await settle();
    expect(sockets[0]!.sent).toHaveLength(before);
    expect(body.info().status).toBe('online');
  });
});
