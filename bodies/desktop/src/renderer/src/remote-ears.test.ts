/** Tests for RemoteEars: frames out, words back, and when handlers are let go. */
import { describe, expect, it, vi } from 'vitest';
import { Pushable } from '@tagalong/ui/shapes';
import type { EarsEvent } from '@tagalong/ui/shapes';
import { RemoteEars } from './remote-ears';

function fakeHost() {
  const handlers = new Set<(event: EarsEvent, text?: string) => void>();
  return {
    earsListen: vi.fn(async () => undefined),
    micFrame: vi.fn(),
    earsStop: vi.fn(async () => undefined),
    onEarsEvent: (handler: (event: EarsEvent, text?: string) => void) => {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    say: (event: EarsEvent, text?: string) => [...handlers].forEach((h) => h(event, text)),
    handlers,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RemoteEars', () => {
  it('starts listening in its mode and sends each frame to main', async () => {
    const host = fakeHost();
    const ears = new RemoteEars(host, 'held');
    const mic = new Pushable<Float32Array>();
    ears.listen(mic);
    mic.push(new Float32Array([0.1]));
    await tick();
    expect(host.earsListen).toHaveBeenCalledWith('held');
    expect(host.micFrame).toHaveBeenCalledWith(new Float32Array([0.1]));
  });

  it('passes on only the event each handler asked for, and stops in main', () => {
    const host = fakeHost();
    const ears = new RemoteEars(host, 'always');
    const turns: (string | undefined)[] = [];
    ears.on('turnEnd', (text) => turns.push(text));
    host.say('partial', 'wh');
    host.say('turnEnd', 'what is this');
    ears.stop();
    expect(turns).toEqual(['what is this']);
    expect(host.earsStop).toHaveBeenCalledOnce();
    expect(host.handlers.size).toBe(0);
  });

  it('sends no more frames once stopped', async () => {
    const host = fakeHost();
    const ears = new RemoteEars(host, 'held');
    const mic = new Pushable<Float32Array>();
    ears.listen(mic);
    ears.stop();
    mic.push(new Float32Array([0.2]));
    await tick();
    expect(host.micFrame).not.toHaveBeenCalled();
  });

  it('held: still hears the turn that ends after stop, then lets go', async () => {
    const host = fakeHost();
    const ears = new RemoteEars(host, 'held');
    const turns: (string | undefined)[] = [];
    ears.on('turnEnd', (text) => turns.push(text));
    ears.stop();
    host.say('turnEnd', 'what is this');
    await tick();
    host.say('turnEnd', 'not mine');
    expect(turns).toEqual(['what is this']);
    expect(host.handlers.size).toBe(0);
  });

  it('says so when listening could not start', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const host = fakeHost();
    host.earsListen.mockRejectedValueOnce(new Error('brain offline'));
    new RemoteEars(host, 'held').listen(new Pushable<Float32Array>());
    await tick();
    expect(warn).toHaveBeenCalledWith('[ears] could not start', expect.any(Error));
    warn.mockRestore();
  });
});
