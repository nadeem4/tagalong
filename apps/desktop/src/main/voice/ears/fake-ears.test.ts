import { describe, expect, it } from 'vitest';
import { EARS_FRAME, Pushable } from '@tagalong/protocol';
import { FAKE_ALWAYS_TRANSCRIPT, FAKE_TRANSCRIPT, FAKE_TURN_FRAMES, FakeEars } from './fake-ears';

const FRAME = new Float32Array(EARS_FRAME);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function run(mode: 'held' | 'always') {
  const ears = new FakeEars(mode);
  const events: string[] = [];
  for (const e of ['speechStart', 'partial', 'final', 'turnEnd'] as const)
    ears.on(e, (text) => events.push(text === undefined ? e : `${e}:${text}`));
  const mic = new Pushable<Float32Array>();
  ears.listen(mic);
  return { ears, events, mic };
}

describe('FakeEars', () => {
  it('held: hears the fixed question when listening stops', async () => {
    const { ears, events, mic } = run('held');
    mic.push(FRAME);
    await tick();
    expect(events).toEqual(['speechStart', 'partial:What am I']);
    ears.stop();
    expect(events.slice(-2)).toEqual([`final:${FAKE_TRANSCRIPT}`, `turnEnd:${FAKE_TRANSCRIPT}`]);
  });

  it('held: hears the fixed question once when the mic ends, as listening stopping does', async () => {
    const { ears, events, mic } = run('held');
    mic.push(FRAME);
    mic.end();
    await tick();
    expect(events.at(-1)).toBe(`turnEnd:${FAKE_TRANSCRIPT}`);
    ears.stop();
    expect(events.filter((e) => e.startsWith('turnEnd'))).toEqual([`turnEnd:${FAKE_TRANSCRIPT}`]);
  });

  it('always: ends one turn by itself after a few frames, addressing Scout, needing no model', async () => {
    const { events, mic } = run('always');
    for (let i = 0; i < FAKE_TURN_FRAMES; i += 1) mic.push(FRAME);
    await tick();
    expect(events[1]).toBe('partial:Scout, what am I');
    expect(events.at(-1)).toBe(`turnEnd:${FAKE_ALWAYS_TRANSCRIPT}`);
  });
});
