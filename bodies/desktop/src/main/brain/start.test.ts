/** Tests for startBrain: where it dials and that it starts dialling at once. */
import { describe, expect, it } from 'vitest';
import { startBrain } from './start';
import type { BrainSocket } from './brain-client';

function setup(env: NodeJS.ProcessEnv) {
  const urls: string[] = [];
  const noop = () => undefined;
  const brain = startBrain({
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
});
