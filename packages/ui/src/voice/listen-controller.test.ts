import { describe, expect, it, vi } from 'vitest';
import type { Ears, EarsEvent, ListenMode, MicStream } from '@tagalong/protocol';
import { ListenController } from './listen-controller';
import type { ListenMic } from './listen-controller';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeMic = (close = vi.fn()): ListenMic & { close: typeof close } =>
  Object.assign((async function* () {})(), { close });

/** Every ears made hears the one stream of events, as each window does from main. */
function fakeEars() {
  const handlers = new Map<EarsEvent, Set<(text?: string) => void>>();
  const made: {
    mode: ListenMode;
    ears: Ears & { listening: MicStream | null; stopped: boolean };
  }[] = [];
  const make = (mode: ListenMode) => {
    const ears = {
      listening: null as MicStream | null,
      stopped: false,
      listen(mic: MicStream) {
        this.listening = mic;
      },
      stop() {
        this.stopped = true;
      },
      on: (event: EarsEvent, handler: (text?: string) => void) =>
        void handlers.set(event, (handlers.get(event) ?? new Set()).add(handler)),
    };
    made.push({ mode, ears });
    return ears;
  };
  return {
    make,
    made,
    say: (event: EarsEvent, text?: string) => handlers.get(event)?.forEach((h) => h(text)),
  };
}

function setup(openMic: () => Promise<ListenMic> = vi.fn(async () => fakeMic())) {
  const ears = fakeEars();
  const calls = {
    speechStart: vi.fn(),
    partial: vi.fn(),
    heard: vi.fn(),
    nothing: vi.fn(),
    failed: vi.fn(),
  };
  const controller = new ListenController({
    ears: ears.make,
    openMic,
    onSpeechStart: calls.speechStart,
    onPartial: calls.partial,
    onHeard: calls.heard,
    onNothingHeard: calls.nothing,
    onMicFailed: calls.failed,
  });
  return { controller, ears, calls, openMic: openMic as ReturnType<typeof vi.fn> };
}

describe('ListenController, held', () => {
  it('opens the mic on hold, closes it on release, and hands over what was heard', async () => {
    const { controller, ears, calls, openMic } = setup();
    controller.hold();
    await tick();
    expect(controller.mode).toBe('held');
    expect(ears.made[0]?.mode).toBe('held');
    expect(ears.made[0]?.ears.listening).not.toBeNull();
    ears.say('speechStart');
    ears.say('partial', 'what is');
    ears.say('partial', '');
    controller.release();
    await tick();
    const mic = await openMic.mock.results[0]!.value;
    expect(mic.close).toHaveBeenCalledOnce();
    expect(ears.made[0]?.ears.stopped).toBe(true);
    ears.say('turnEnd', ' what is this ');
    expect(calls.speechStart).toHaveBeenCalledOnce();
    expect(calls.partial).toHaveBeenCalledOnce();
    expect(calls.partial).toHaveBeenCalledWith('what is');
    expect(calls.heard).toHaveBeenCalledWith('what is this');
    expect(controller.mode).toBeNull();
  });

  it('listens with the open mic itself', async () => {
    const mic = fakeMic();
    const { controller, ears } = setup(vi.fn(async () => mic));
    controller.hold();
    await tick();
    expect(ears.made[0]?.ears.listening).toBe(mic);
  });

  it('says nothing was heard for an empty turn', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    ears.say('turnEnd', '');
    expect(calls.nothing).toHaveBeenCalledOnce();
    expect(calls.heard).not.toHaveBeenCalled();
  });

  it('closes a mic that opens after the release, and never listens with it', async () => {
    let open!: (mic: ListenMic) => void;
    const close = vi.fn();
    const { controller, ears, calls } = setup(
      vi.fn(() => new Promise<ListenMic>((resolve) => (open = resolve))),
    );
    controller.hold();
    controller.release();
    open(fakeMic(close));
    await tick();
    expect(close).toHaveBeenCalledOnce();
    expect(ears.made[0]?.ears.listening).toBeNull();
    expect(calls.nothing).toHaveBeenCalledOnce();
  });

  it('cancel drops the question: the mic closes and a late turn is ignored', async () => {
    const { controller, ears, calls, openMic } = setup();
    controller.hold();
    await tick();
    controller.cancel();
    await tick();
    expect((await openMic.mock.results[0]!.value).close).toHaveBeenCalledOnce();
    expect(ears.made[0]?.ears.stopped).toBe(true);
    ears.say('turnEnd', 'what is this');
    expect(calls.heard).not.toHaveBeenCalled();
    expect(controller.mode).toBeNull();
  });

  it('reports a mic that will not open, and is ready to try again', async () => {
    const { controller, calls } = setup(vi.fn(async () => Promise.reject(new Error('denied'))));
    controller.hold();
    await tick();
    expect(calls.failed).toHaveBeenCalledWith(expect.objectContaining({ message: 'denied' }));
    expect(controller.mode).toBeNull();
  });

  it('holds one session at a time, and release or cancel with none is nothing', async () => {
    const { controller, ears, calls } = setup();
    controller.release();
    controller.cancel();
    controller.hold();
    controller.hold();
    await tick();
    expect(ears.made).toHaveLength(1);
    expect(calls.nothing).not.toHaveBeenCalled();
  });

  it('a held turn is not over until it is released', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    ears.say('turnEnd', 'too soon');
    expect(calls.heard).not.toHaveBeenCalled();
    expect(controller.mode).toBe('held');
  });

  it('the turn that ends after the next press began belongs to the released session', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    controller.hold();
    await tick();
    ears.say('turnEnd', 'first');
    expect(calls.heard).toHaveBeenCalledOnce();
    expect(calls.heard).toHaveBeenLastCalledWith('first');
    expect(controller.mode).toBe('held');
    controller.release();
    ears.say('turnEnd', 'second');
    expect(calls.heard).toHaveBeenCalledTimes(2);
    expect(calls.heard).toHaveBeenLastCalledWith('second');
  });
});
