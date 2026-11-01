/** Tests for the mic level meter's maths and watcher, on fake microphones (no audio, no DOM). */
import { describe, expect, it, vi } from 'vitest';
import { frameLevel, watchLevel } from './mic-level';
import type { OpenMic } from './mic';

function tone(amplitude: number, length = 512): Float32Array {
  return Float32Array.from({ length }, (_, i) => amplitude * Math.sin((2 * Math.PI * i) / 32));
}

/** A mic whose frames the test pushes by hand; `fail` makes the stream throw. */
function fakeMic() {
  const queue: (Float32Array | Error | null)[] = [];
  let wake: (() => void) | null = null;
  const close = vi.fn();
  const push = (item: Float32Array | Error | null): void => {
    queue.push(item);
    wake?.();
  };
  const mic: OpenMic = {
    close,
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        while (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve));
        const item = queue.shift()!;
        if (item === null) return { value: undefined, done: true as const };
        if (item instanceof Error) throw item;
        return { value: item, done: false as const };
      },
      return: () => Promise.resolve({ value: undefined, done: true as const }),
    }),
  };
  return { mic, close, push };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('frameLevel', () => {
  it('of silence is 0', () => expect(frameLevel(new Float32Array(256))).toBe(0));
  it('of a full-scale square is 1', () =>
    expect(frameLevel(new Float32Array(256).fill(1))).toBeCloseTo(1, 5));
  it('of a -30 dB tone is about 0.5', () =>
    expect(frameLevel(tone(Math.SQRT2 * 10 ** (-30 / 20)))).toBeCloseTo(0.5, 1));
  it('of an empty frame is 0', () => expect(frameLevel(new Float32Array(0))).toBe(0));
});

describe('watchLevel', () => {
  it('calls onLevel per frame and decays after a loud one', async () => {
    const { mic, push } = fakeMic();
    const levels: number[] = [];
    watchLevel(
      () => Promise.resolve(mic),
      (n) => levels.push(n),
    );
    push(new Float32Array(256).fill(1));
    push(new Float32Array(256));
    push(new Float32Array(256));
    await settle();
    expect(levels).toHaveLength(3);
    expect(levels[0]).toBeCloseTo(1, 5);
    expect(levels[1]).toBeLessThan(levels[0]!);
    expect(levels[1]).toBeGreaterThan(0);
    expect(levels[2]).toBeLessThan(levels[1]!);
  });

  it('stop closes the mic exactly once', async () => {
    const { mic, close, push } = fakeMic();
    const watch = watchLevel(
      () => Promise.resolve(mic),
      () => undefined,
    );
    push(tone(0.1));
    await settle();
    watch.stop();
    watch.stop();
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes a mic that finished opening after stop', async () => {
    const { mic, close } = fakeMic();
    const onLevel = vi.fn();
    const watch = watchLevel(() => Promise.resolve(mic), onLevel);
    watch.stop();
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onLevel).not.toHaveBeenCalled();
  });

  it('an open failure calls no level, reports the reason and does not throw', async () => {
    const onLevel = vi.fn();
    const onError = vi.fn();
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    watchLevel(() => Promise.reject(denied), onLevel, onError);
    await settle();
    expect(onLevel).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith('denied');
  });

  it('a throwing stream closes the mic', async () => {
    const { mic, close, push } = fakeMic();
    const onError = vi.fn();
    watchLevel(
      () => Promise.resolve(mic),
      () => undefined,
      onError,
    );
    push(new Error('device lost'));
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('no-mic');
  });

  it('a stream that ends by itself closes the mic and reports no microphone', async () => {
    const { mic, close, push } = fakeMic();
    const onError = vi.fn();
    watchLevel(
      () => Promise.resolve(mic),
      () => undefined,
      onError,
    );
    push(null);
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('no-mic');
  });

  it('a stream that ends after stop reports nothing', async () => {
    const { mic, push } = fakeMic();
    const onError = vi.fn();
    const watch = watchLevel(
      () => Promise.resolve(mic),
      () => undefined,
      onError,
    );
    await settle();
    watch.stop();
    push(null);
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });

  it('a frame already queued when stop is called never reaches onLevel', async () => {
    const { mic, push } = fakeMic();
    const onLevel = vi.fn();
    const watch = watchLevel(() => Promise.resolve(mic), onLevel);
    await settle();
    push(tone(0.5));
    watch.stop();
    await settle();
    expect(onLevel).not.toHaveBeenCalled();
  });
});
