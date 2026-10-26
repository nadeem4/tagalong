/** Tests for startBrain: where it dials, that it starts at once, and the tools it declares. */
import { describe, expect, it } from 'vitest';
import type { CaptureExclusions } from '@tagalong/protocol';
import { startBrain } from './start';
import type { BrainSocket } from './brain-client';
import type { Platform } from '../platform/index';

const noop = () => undefined;
const tools = {
  platform: { listWindows: async () => ({ windows: [] }) } as unknown as Platform,
  exclusions: () => ({}) as CaptureExclusions,
  onCapture: noop,
};

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

  it('declares the window tools in hello and answers use for them', async () => {
    const sent: string[] = [];
    let message: (data: string) => void = noop;
    let open: () => void = noop;
    const brain = startBrain({
      ...tools,
      env: {},
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
    });
    open();
    const hello = JSON.parse(sent[0] as string);
    expect(hello.params.tools.map((t: { name: string }) => t.name)).toEqual([
      'list_windows',
      'read_window_text',
      'look_at_window',
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
