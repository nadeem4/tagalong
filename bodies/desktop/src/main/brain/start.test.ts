/** Tests for startBrain: where it dials, that it starts at once, and the tools it declares. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureExclusions } from '../../shared/settings';
import { startBrain } from './start';
import type { BrainSocket } from '@tagalong/contract';
import type { Platform } from '../platform/index';

const noop = () => undefined;
const localLink = {
  paired: () => null,
  token: () => null,
  markGood: noop,
  addAddrs: noop,
};
const tools = {
  link: localLink,
  search: async () => [] as string[],
  platform: { listWindows: async () => ({ windows: [] }) } as unknown as Platform,
  exclusions: () => ({}) as CaptureExclusions,
  onCapture: noop,
  openExternal: async () => undefined,
  files: { folders: () => [], trash: async () => undefined },
  reading: {
    detect: async () => ({ rows: [] }),
    install: async () => ({ outcome: 'installed' as const, message: '' }),
    push: noop,
  },
};

function homeWithToken(token = 'tok'): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'tg-'));
  writeFileSync(join(home, 'local-token'), token);
  return { TAGALONG_HOME: home };
}

function setup(env: NodeJS.ProcessEnv) {
  const urls: string[] = [];
  const brain = startBrain({
    ...tools,
    env,
    openSocket: (url): BrainSocket => {
      urls.push(url);
      return { send: noop, close: noop, onOpen: noop, onMessage: noop, onClose: noop };
    },
    onNotification: noop,
    onStatus: noop,
    onResync: noop,
    bodyId: 'desktop-a1b2c3',
  });
  brain.stop();
  return urls;
}

describe('startBrain', () => {
  it('dials the default address', () => {
    expect(setup({})).toEqual(['ws://127.0.0.1:47321']);
  });

  it('dials TAGALONG_BRAIN_ADDR when it is set', () => {
    expect(setup({ TAGALONG_BRAIN_ADDR: '10.0.0.5:9000' })).toEqual(['ws://10.0.0.5:9000']);
  });

  it('sends the PC name as the body name', () => {
    const sent: string[] = [];
    let open: () => void = noop;
    const brain = startBrain({
      ...tools,
      env: homeWithToken(),
      openSocket: (): BrainSocket => ({
        send: (data) => void sent.push(data),
        close: noop,
        onOpen: (f) => void (open = f),
        onMessage: noop,
        onClose: noop,
      }),
      onNotification: noop,
      onStatus: noop,
      onResync: noop,
      bodyId: 'desktop-a1b2c3',
    });
    open();
    expect(JSON.parse(sent[0] as string).params.body).toEqual({
      id: 'desktop-a1b2c3',
      kind: 'desktop',
      name: hostname(),
    });
    brain.stop();
  });

  it('sends the local token from the home folder in hello', () => {
    const sent: string[] = [];
    let open: () => void = noop;
    const brain = startBrain({
      ...tools,
      env: homeWithToken('tok-from-file\n'),
      openSocket: (): BrainSocket => ({
        send: (data) => void sent.push(data),
        close: noop,
        onOpen: (f) => void (open = f),
        onMessage: noop,
        onClose: noop,
      }),
      onNotification: noop,
      onStatus: noop,
      onResync: noop,
      bodyId: 'desktop-a1b2c3',
    });
    open();
    expect(JSON.parse(sent[0] as string).params.token).toBe('tok-from-file');
    brain.stop();
  });

  it('declares the window tools in hello and answers use for them', async () => {
    const sent: string[] = [];
    let message: (data: string) => void = noop;
    let open: () => void = noop;
    const brain = startBrain({
      ...tools,
      env: homeWithToken(),
      openSocket: (): BrainSocket => ({
        send: (data) => void sent.push(data),
        close: noop,
        onOpen: (f) => void (open = f),
        onMessage: (f) => void (message = f),
        onClose: noop,
      }),
      onNotification: noop,
      onStatus: noop,
      onResync: noop,
      bodyId: 'desktop-a1b2c3',
    });
    open();
    const hello = JSON.parse(sent[0] as string);
    expect(hello.params.tools.map((t: { name: string }) => t.name)).toEqual([
      'list_windows',
      'read_window_text',
      'look_at_window',
      'open_url',
      'list_files',
      'read_file',
      'move_file',
      'rename_file',
      'delete_file',
      'write_file',
      'install_ocr_language',
    ]);

    const result = { protocol: 1, session: 's', tools: [], seq: 0, resync: false };
    message(JSON.stringify({ jsonrpc: '2.0', id: hello.id, result }));
    const params = { call: 'c1', tool: 'list_windows', input: {} };
    message(JSON.stringify({ jsonrpc: '2.0', id: 'b1', method: 'use', params }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(JSON.parse(sent.at(-1) as string)).toMatchObject({
      id: 'b1',
      result: { output: [{ type: 'text' }] },
    });
    brain.stop();
  });
});

describe('startBrain with a paired remote brain', () => {
  const fp = 'ef'.repeat(64 / 2);
  afterEach(() => vi.useRealTimers());

  function remote(over: { search?: () => Promise<string[]> } = {}) {
    vi.useFakeTimers();
    const good: string[] = [];
    const added: string[][] = [];
    let paired: { addrs: string[]; lastGood: string; fp: string } = {
      addrs: ['10.0.0.5:47323', '100.64.0.2:47323'],
      lastGood: '100.64.0.2:47323',
      fp,
    };
    const link = {
      paired: () => paired,
      token: () => 'device-token',
      markGood: (addr: string) => void good.push(addr),
      addAddrs: (addrs: string[]) => void added.push(addrs),
    };
    const sockets: {
      url: string;
      open: () => void;
      drop: () => void;
      message: (data: string) => void;
    }[] = [];
    const sent: string[] = [];
    const statuses: string[] = [];
    const search = vi.fn(over.search ?? (async () => [] as string[]));
    const brain = startBrain({
      ...tools,
      link,
      search,
      env: {},
      openSocket: (url): BrainSocket => {
        const entry = {
          url,
          open: noop as () => void,
          drop: noop as () => void,
          message: noop as (data: string) => void,
        };
        sockets.push(entry);
        return {
          send: (data) => void sent.push(data),
          close: noop,
          onOpen: (f) => void (entry.open = f),
          onMessage: (f) => void (entry.message = f),
          onClose: (f) => void (entry.drop = f),
        };
      },
      onNotification: noop,
      onStatus: (status) => void statuses.push(status),
      onResync: noop,
      bodyId: 'desktop-a1b2c3',
    });
    const message = (data: object) => void sockets.at(-1)!.message(JSON.stringify(data));
    const fail = async (): Promise<void> => {
      sockets.at(-1)!.drop();
      await vi.advanceTimersByTimeAsync(2000);
    };
    const pair = (next: typeof paired): void => void (paired = next);
    return { brain, sockets, sent, good, added, message, search, fail, pair };
  }

  it('dials wss on the last good address first with the device token, and remembers the one that said hello', () => {
    const { brain, sockets, sent, good, message } = remote();
    sockets[0]!.open();
    expect(sockets[0]!.url).toBe('wss://100.64.0.2:47323');
    const hello = JSON.parse(sent[0] as string);
    expect(hello.params.token).toBe('device-token');
    message({
      jsonrpc: '2.0',
      id: hello.id,
      result: { protocol: 3, session: 's', tools: [], seq: 0, resync: false },
    });
    expect(good).toEqual(['100.64.0.2:47323']);
    brain.stop();
  });

  it('saves the addresses the brain lists in hello', () => {
    const { brain, sockets, sent, added, message } = remote();
    sockets[0]!.open();
    message({
      jsonrpc: '2.0',
      id: JSON.parse(sent[0] as string).id,
      result: {
        protocol: 3,
        session: 's',
        tools: [],
        seq: 0,
        resync: false,
        addrs: ['100.64.0.7:47323'],
      },
    });
    expect(added).toEqual([['100.64.0.7:47323']]);
    brain.stop();
  });

  it('moves to the next address when one fails, and never marks a failed one good', async () => {
    const { brain, sockets, good, fail } = remote();
    await fail();
    expect(sockets.map((s) => s.url)).toEqual(['wss://100.64.0.2:47323', 'wss://10.0.0.5:47323']);
    expect(good).toEqual([]);
    brain.stop();
  });

  it('looks for brains on the network only after every saved address failed, at most every 30 seconds', async () => {
    const { brain, sockets, search, fail } = remote({ search: async () => ['192.168.1.9:47323'] });
    expect(search).not.toHaveBeenCalled();
    await fail();
    expect(search).not.toHaveBeenCalled();
    await fail();
    expect(search).toHaveBeenCalledTimes(1);
    await fail();
    await fail();
    expect(sockets.map((s) => s.url)).toContain('wss://192.168.1.9:47323');
    expect(search).toHaveBeenCalledTimes(1);
    brain.stop();
  });

  it('starts over from the first address when the link is replaced', async () => {
    const { brain, sockets, fail, pair } = remote();
    pair({ addrs: ['10.9.9.9:47323'], lastGood: '10.9.9.9:47323', fp });
    await fail();
    expect(sockets.at(-1)!.url).toBe('wss://10.9.9.9:47323');
    brain.stop();
  });

  it('does not count a stop as a failed dial, so the last good address is still first', () => {
    const { brain, sockets } = remote();
    brain.stop();
    brain.start();
    expect(sockets.at(-1)!.url).toBe('wss://100.64.0.2:47323');
    brain.stop();
  });
});
