/** Tests for ListenController: held and always. */

import { describe, expect, it, vi } from 'vitest';
import type { Ears, EarsEvent, ListenMode, MicStream } from '../shapes';
import { ListenController } from './listen-controller';
import type { ListenControllerOptions, ListenMic } from './listen-controller';

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

/** Timers the test fires by hand: what is pending, and how long each would wait. */
function fakeTimers() {
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  return {
    set: (run: () => void, ms: number) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => void (timer.live = false);
    },
    pending: () => timers.filter((t) => t.live).map((t) => t.ms),
    fire: () =>
      timers
        .filter((t) => t.live)
        .forEach((t) => {
          t.live = false;
          t.run();
        }),
  };
}

function setup(
  openMic: () => Promise<ListenMic> = vi.fn(async () => fakeMic()),
  more: Partial<ListenControllerOptions> = {},
) {
  const ears = fakeEars();
  const calls = {
    speechStart: vi.fn(),
    partial: vi.fn(),
    heard: vi.fn(),
    nothing: vi.fn(),
    failed: vi.fn(),
    stop: vi.fn(),
    dropped: vi.fn(),
  };
  const controller = new ListenController({
    ears: ears.make,
    openMic,
    onSpeechStart: calls.speechStart,
    onPartial: calls.partial,
    onHeard: calls.heard,
    onNothingHeard: calls.nothing,
    onMicFailed: calls.failed,
    onStopListening: calls.stop,
    onDropped: calls.dropped,
    ...more,
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
    expect(calls.partial.mock.calls).toEqual([['what is', 'held']]);
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

  it('says the mic is open only once it has opened', async () => {
    let open!: (mic: ListenMic) => void;
    const onMicOpen = vi.fn();
    const { controller } = setup(
      vi.fn(() => new Promise<ListenMic>((resolve) => (open = resolve))),
      { onMicOpen },
    );
    controller.hold();
    await tick();
    expect(onMicOpen).not.toHaveBeenCalled();
    open(fakeMic());
    await tick();
    expect(onMicOpen).toHaveBeenCalledExactlyOnceWith('held');
  });

  it('never says a mic that would not open is open', async () => {
    const onMicOpen = vi.fn();
    const { controller } = setup(
      vi.fn(async () => Promise.reject(new Error('busy'))),
      { onMicOpen },
    );
    controller.hold();
    await tick();
    expect(onMicOpen).not.toHaveBeenCalled();
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
    await tick();
    controller.release();
    ears.say('turnEnd', 'second');
    expect(calls.heard).toHaveBeenCalledTimes(2);
    expect(calls.heard).toHaveBeenLastCalledWith('second');
  });

  it('cancel drops a released question whose words never came, so the next is heard once', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    controller.cancel();
    controller.hold();
    await tick();
    controller.release();
    ears.say('turnEnd', 'x');
    expect(calls.heard).toHaveBeenCalledOnce();
    expect(calls.heard).toHaveBeenCalledWith('x');
  });

  it('cancel drops every released question still waiting for its words', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    controller.hold();
    await tick();
    controller.release();
    controller.cancel();
    ears.say('turnEnd', 'late');
    ears.say('turnEnd', 'later');
    expect(calls.heard).not.toHaveBeenCalled();
    expect(calls.nothing).not.toHaveBeenCalled();
  });

  it('cancel before the mic opens closes it, and never listens with it', async () => {
    let open!: (mic: ListenMic) => void;
    const close = vi.fn();
    const { controller, ears, calls } = setup(
      vi.fn(() => new Promise<ListenMic>((resolve) => (open = resolve))),
    );
    controller.hold();
    controller.cancel();
    open(fakeMic(close));
    await tick();
    expect(close).toHaveBeenCalledOnce();
    expect(ears.made[0]?.ears.listening).toBeNull();
    expect(calls.nothing).not.toHaveBeenCalled();
    expect(controller.mode).toBeNull();
    // It never listened, so there is nothing to stop: a stop now could end another session.
    expect(ears.made[0]?.ears.stopped).toBe(false);
  });

  it('released questions take their words in the order they were released', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    controller.hold();
    await tick();
    controller.release();
    ears.say('turnEnd', 'first');
    expect(calls.heard.mock.calls).toEqual([['first']]);
    // Each ears event crosses IPC as its own message, so the next one comes in a later task.
    await tick();
    ears.say('turnEnd', 'second');
    expect(calls.heard.mock.calls).toEqual([['first'], ['second']]);
  });

  it('the talk key listens again after the ears failed mid-question', async () => {
    const { controller, ears, openMic } = setup();
    controller.hold();
    await tick();
    expect(controller.earsFailed()).toBe('held');
    controller.hold();
    await tick();
    expect(controller.mode).toBe('held');
    expect(openMic).toHaveBeenCalledTimes(2);
    expect(ears.made[1]?.ears.listening).not.toBeNull();
  });
});

describe('ListenController, always', () => {
  it('listens while on, keeps listening after each turn, and closes the mic when switched off', async () => {
    const { controller, ears, calls, openMic } = setup();
    controller.setAlways(true);
    await tick();
    expect(controller.mode).toBe('always');
    expect(ears.made[0]?.mode).toBe('always');
    ears.say('turnEnd', 'Scout, first question');
    ears.say('turnEnd', 'Scout, second question');
    expect(calls.heard.mock.calls).toEqual([['first question'], ['second question']]);
    expect(controller.mode).toBe('always');
    controller.setAlways(false);
    await tick();
    expect((await openMic.mock.results[0]!.value).close).toHaveBeenCalledOnce();
    expect(ears.made[0]?.ears.stopped).toBe(true);
    expect(controller.mode).toBeNull();
  });

  it('closes the mic during a call or full screen and opens it again after', async () => {
    const { controller, openMic } = setup();
    controller.setAlways(true);
    await tick();
    controller.setPaused(true);
    await tick();
    expect(controller.mode).toBeNull();
    expect((await openMic.mock.results[0]!.value).close).toHaveBeenCalledOnce();
    controller.setPaused(false);
    await tick();
    expect(openMic).toHaveBeenCalledTimes(2);
    expect(controller.mode).toBe('always');
  });

  it('is deaf while the system voice speaks, so Scout never answers or stops itself', async () => {
    const { controller, ears, calls, openMic } = setup();
    controller.setAlways(true);
    await tick();
    controller.setDeaf(true);
    await tick();
    expect((await openMic.mock.results[0]!.value).close).toHaveBeenCalledOnce();
    ears.say('speechStart');
    ears.say('partial', 'Scout, what');
    ears.say('turnEnd', 'Scout, what is that');
    ears.say('turnEnd', 'Scout, stop');
    expect(calls.speechStart).not.toHaveBeenCalled();
    expect(calls.partial).not.toHaveBeenCalled();
    expect(calls.heard).not.toHaveBeenCalled();
    expect(calls.stop).not.toHaveBeenCalled();
    controller.setDeaf(false);
    await tick();
    expect(controller.mode).toBe('always');
  });

  it('the talk key asks without the name while listening all the time, then listening resumes', async () => {
    const order: string[] = [];
    const { controller, ears, calls } = setup(
      vi.fn(async () => {
        order.push(`open, always stopped: ${String(ears.made[0]?.ears.stopped)}`);
        return fakeMic();
      }),
    );
    controller.setAlways(true);
    await tick();
    controller.hold();
    await tick();
    expect(controller.mode).toBe('held');
    expect(ears.made.map((made) => made.mode)).toEqual(['always', 'held']);
    // The always session ends before the held one opens its mic: the voice process runs them in order.
    expect(order).toEqual(['open, always stopped: false', 'open, always stopped: true']);
    ears.say('partial', 'what is');
    controller.release();
    await tick();
    expect(controller.mode).toBe('always');
    expect(ears.made.map((made) => made.mode)).toEqual(['always', 'held', 'always']);
    ears.say('turnEnd', 'what is this');
    expect(calls.partial.mock.calls).toEqual([['what is', 'held']]);
    expect(calls.heard.mock.calls).toEqual([['what is this']]);
    // Always listening goes on as before: only "Scout" asks.
    await tick();
    ears.say('turnEnd', 'what is that');
    ears.say('turnEnd', 'Scout, and that?');
    expect(calls.heard.mock.calls).toEqual([['what is this'], ['and that?']]);
  });

  it('cancel while listening all the time keeps listening', async () => {
    const { controller, ears, openMic } = setup();
    controller.setAlways(true);
    await tick();
    controller.cancel();
    await tick();
    expect(controller.mode).toBe('always');
    expect(openMic).toHaveBeenCalledOnce();
    expect(ears.made[0]?.ears.stopped).toBe(false);
  });

  it('cancel drops a question held while listening all the time, and listening resumes', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    controller.hold();
    await tick();
    controller.cancel();
    await tick();
    expect(controller.mode).toBe('always');
    expect(ears.made[1]?.ears.stopped).toBe(true);
    ears.say('turnEnd', 'what is this');
    expect(calls.heard).not.toHaveBeenCalled();
  });

  it('ending the session mid-turn after "Scout" cut Scout off lets the bubble go', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('partial', 'Scout, wh');
    controller.setPaused(true);
    expect(calls.dropped).toHaveBeenCalledOnce();
    controller.setPaused(false);
    await tick();
    // A session ended with nothing addressed drops nothing.
    controller.setDeaf(true);
    expect(calls.dropped).toHaveBeenCalledOnce();
  });

  it('the ears failing ends the always session but leaves it switched on: the next change retries', async () => {
    const { controller, ears, openMic } = setup(undefined, { setTimer: fakeTimers().set });
    controller.setAlways(true);
    await tick();
    expect(controller.earsFailed()).toBe('always');
    await tick();
    expect(controller.mode).toBeNull();
    expect(ears.made[0]?.ears.stopped).toBe(true);
    expect(openMic).toHaveBeenCalledOnce();
    // The system voice speaking and stopping, a call, or the switch: listening tries again.
    controller.setDeaf(true);
    controller.setDeaf(false);
    await tick();
    expect(controller.mode).toBe('always');
    expect(openMic).toHaveBeenCalledTimes(2);
  });

  it('the ears failing retries on its own, waiting longer each time, up to five minutes', async () => {
    const timers = fakeTimers();
    const { controller, openMic } = setup(undefined, { setTimer: timers.set, retryMs: 1_000 });
    controller.setAlways(true);
    await tick();
    controller.earsFailed();
    expect(timers.pending()).toEqual([1_000]);
    timers.fire();
    await tick();
    expect(controller.mode).toBe('always');
    expect(openMic).toHaveBeenCalledTimes(2);
    controller.earsFailed();
    expect(timers.pending()).toEqual([2_000]);
    for (let i = 0; i < 12; i += 1) {
      timers.fire();
      await tick();
      controller.earsFailed();
    }
    expect(timers.pending()).toEqual([300_000]);
  });

  it('switching always listening off cancels the retry', async () => {
    const timers = fakeTimers();
    const { controller, openMic } = setup(undefined, { setTimer: timers.set });
    controller.setAlways(true);
    await tick();
    controller.earsFailed();
    expect(timers.pending()).toEqual([30_000]);
    controller.setAlways(false);
    expect(timers.pending()).toEqual([]);
    await tick();
    expect(openMic).toHaveBeenCalledOnce();
  });

  it('a question heard after a retry starts the wait over', async () => {
    const timers = fakeTimers();
    const { controller, ears } = setup(undefined, { setTimer: timers.set, retryMs: 1_000 });
    controller.setAlways(true);
    await tick();
    controller.earsFailed();
    timers.fire();
    await tick();
    ears.say('turnEnd', 'Scout, hello');
    controller.earsFailed();
    expect(timers.pending()).toEqual([1_000]);
  });

  it('the ears failing drops a held question and every released one, without resuming', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    controller.hold();
    await tick();
    controller.release();
    controller.hold();
    await tick();
    expect(controller.earsFailed()).toBe('held');
    await tick();
    expect(controller.mode).toBeNull();
    ears.say('turnEnd', 'late');
    expect(calls.heard).not.toHaveBeenCalled();
    expect(controller.earsFailed()).toBeNull();
  });

  it('still lets the talk key work during a call, and does not reopen afterwards on its own', async () => {
    const { controller, openMic } = setup();
    controller.setAlways(true);
    controller.setPaused(true);
    await tick();
    controller.hold();
    await tick();
    expect(controller.mode).toBe('held');
    controller.release();
    await tick();
    expect(controller.mode).toBeNull();
    expect(openMic).toHaveBeenCalledTimes(2);
  });

  it('lets talk that is not addressed to Scout go nowhere, not even the bubble', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('speechStart');
    ears.say('partial', 'what is');
    ears.say('turnEnd', 'what is this');
    ears.say('turnEnd', '');
    ears.say('turnEnd', 'Scout');
    expect(calls.speechStart).not.toHaveBeenCalled();
    expect(calls.partial).not.toHaveBeenCalled();
    expect(calls.heard).not.toHaveBeenCalled();
    expect(calls.nothing).not.toHaveBeenCalled();
    expect(calls.stop).not.toHaveBeenCalled();
  });

  it('cuts Scout off once a turn is addressed to it, and asks what follows the name', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('partial', 'hey');
    ears.say('partial', 'Hey Scout, what');
    ears.say('partial', 'hey scout, what is');
    ears.say('turnEnd', 'Hey Scout, what is this?');
    expect(calls.speechStart).toHaveBeenCalledOnce();
    expect(calls.partial.mock.calls).toEqual([
      ['Hey Scout, what', 'always'],
      ['hey scout, what is', 'always'],
    ]);
    expect(calls.heard.mock.calls).toEqual([['what is this?']]);
    // The next turn barges in again.
    ears.say('turnEnd', 'scout, and that?');
    expect(calls.speechStart).toHaveBeenCalledTimes(2);
    expect(calls.heard).toHaveBeenLastCalledWith('and that?');
  });

  it('"Scout, stop" switches listening off and is never asked', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('turnEnd', 'Scout, stop.');
    expect(calls.stop).toHaveBeenCalledOnce();
    expect(calls.speechStart).toHaveBeenCalledOnce();
    expect(calls.heard).not.toHaveBeenCalled();
  });

  it('a partial "Scout, st" might still be "stop": it neither cuts Scout off nor shows', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('partial', 'Scout, st');
    ears.say('partial', 'Scout, stop list');
    expect(calls.speechStart).not.toHaveBeenCalled();
    expect(calls.partial).not.toHaveBeenCalled();
    ears.say('turnEnd', 'Scout, stop.');
    expect(calls.stop).toHaveBeenCalledOnce();
    expect(calls.heard).not.toHaveBeenCalled();
    // Nothing was cut off, so there is nothing to let go.
    expect(calls.dropped).not.toHaveBeenCalled();
  });

  it('a stop that had cut Scout off lets the bubble go', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('partial', 'Scout, wait');
    expect(calls.speechStart).toHaveBeenCalledOnce();
    ears.say('turnEnd', 'Scout, stop.');
    expect(calls.stop).toHaveBeenCalledOnce();
    expect(calls.dropped).toHaveBeenCalledOnce();
  });

  it('a held question needs no name', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    ears.say('turnEnd', 'what is this');
    expect(calls.heard).toHaveBeenCalledWith('what is this');
  });

  it('switched on while the key is held, it starts listening once the key is let go', async () => {
    const { controller, openMic } = setup();
    controller.hold();
    await tick();
    controller.setAlways(true);
    await tick();
    expect(controller.mode).toBe('held');
    expect(openMic).toHaveBeenCalledOnce();
    controller.release();
    await tick();
    expect(controller.mode).toBe('always');
    expect(openMic).toHaveBeenCalledTimes(2);
  });

  it('a held question released just before listening starts keeps its own words', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    controller.setAlways(true);
    await tick();
    expect(controller.mode).toBe('always');
    // The voice process runs sessions in order: the held question's words come first.
    ears.say('partial', 'Scout, the held');
    ears.say('turnEnd', 'Scout, the held one');
    expect(calls.heard.mock.calls).toEqual([['Scout, the held one']]);
    expect(calls.partial.mock.calls).toEqual([['Scout, the held', 'held']]);
    expect(calls.speechStart).not.toHaveBeenCalled();
    await tick();
    ears.say('turnEnd', 'Scout, the always one');
    expect(calls.heard.mock.calls).toEqual([['Scout, the held one'], ['the always one']]);
  });

  it('a question asked during a call keeps its words when listening comes back', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    controller.setPaused(true);
    controller.hold();
    await tick();
    controller.release();
    controller.setPaused(false);
    await tick();
    expect(controller.mode).toBe('always');
    ears.say('turnEnd', 'what is this');
    expect(calls.heard.mock.calls).toEqual([['what is this']]);
    await tick();
    ears.say('turnEnd', 'Scout, and now?');
    expect(calls.heard.mock.calls).toEqual([['what is this'], ['and now?']]);
  });

  it('going deaf keeps a released question waiting for its words', async () => {
    const { controller, ears, calls } = setup();
    controller.hold();
    await tick();
    controller.release();
    controller.setAlways(true);
    await tick();
    controller.setDeaf(true);
    ears.say('turnEnd', 'what is this');
    expect(calls.heard).toHaveBeenCalledWith('what is this');
  });

  it('switched off before the mic opens, it closes the mic unused and stops nothing', async () => {
    let open!: (mic: ListenMic) => void;
    const close = vi.fn();
    const { controller, ears } = setup(
      vi.fn(() => new Promise<ListenMic>((resolve) => (open = resolve))),
    );
    controller.setAlways(true);
    controller.setAlways(false);
    open(fakeMic(close));
    await tick();
    expect(close).toHaveBeenCalledOnce();
    expect(ears.made[0]?.ears.listening).toBeNull();
    expect(ears.made[0]?.ears.stopped).toBe(false);
    expect(controller.mode).toBeNull();
  });

  it('a turn that stopped Scout but ends with nothing for it lets the bubble go', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('partial', 'Scout, wh');
    ears.say('turnEnd', 'what');
    expect(calls.dropped).toHaveBeenCalledOnce();
    expect(calls.heard).not.toHaveBeenCalled();
    expect(calls.nothing).not.toHaveBeenCalled();
    // The next turn starts fresh: unaddressed again, nothing to let go.
    ears.say('turnEnd', 'what');
    expect(calls.dropped).toHaveBeenCalledOnce();
  });

  it('an unaddressed turn that never stopped Scout drops nothing', async () => {
    const { controller, ears, calls } = setup();
    controller.setAlways(true);
    await tick();
    ears.say('partial', 'what is');
    ears.say('turnEnd', 'what is this');
    ears.say('turnEnd', 'Scout, what is this');
    expect(calls.dropped).not.toHaveBeenCalled();
  });

  it('switching on twice opens one mic', async () => {
    const { controller, openMic } = setup();
    controller.setAlways(true);
    controller.setAlways(true);
    controller.setPaused(false);
    await tick();
    expect(openMic).toHaveBeenCalledOnce();
  });
});

describe('ListenController, the follow-up window', () => {
  async function inWindow(more: Partial<ListenControllerOptions> = {}) {
    const timers = fakeTimers();
    const onFollowUp = vi.fn();
    const made = setup(undefined, { setTimer: timers.set, onFollowUp, ...more });
    made.controller.setAlways(true);
    await tick();
    made.controller.openFollowUp();
    return { ...made, timers, onFollowUp };
  }

  it('takes one reply with no name, then needs the name again', async () => {
    const { ears, calls, onFollowUp } = await inWindow();
    expect(onFollowUp).toHaveBeenLastCalledWith(true);
    ears.say('partial', 'and tomorrow');
    ears.say('turnEnd', 'and tomorrow?');
    expect(calls.heard.mock.calls).toEqual([['and tomorrow?']]);
    expect(calls.partial).toHaveBeenCalledWith('and tomorrow', 'always');
    expect(onFollowUp).toHaveBeenLastCalledWith(false);
    ears.say('turnEnd', 'and the day after?');
    expect(calls.heard).toHaveBeenCalledOnce();
  });

  it('a reply that starts with the name is asked without it, and closes the window', async () => {
    const { ears, calls, onFollowUp } = await inWindow();
    ears.say('turnEnd', 'Scott, and tomorrow?');
    expect(calls.heard.mock.calls).toEqual([['and tomorrow?']]);
    expect(onFollowUp).toHaveBeenLastCalledWith(false);
  });

  it('closes after twenty seconds with no reply', async () => {
    const { ears, calls, timers, onFollowUp } = await inWindow();
    expect(timers.pending()).toContain(20_000);
    timers.fire();
    expect(onFollowUp).toHaveBeenLastCalledWith(false);
    ears.say('turnEnd', 'and tomorrow?');
    expect(calls.heard).not.toHaveBeenCalled();
  });

  it.each([
    ['a call or full screen', (c: ListenController) => c.setPaused(true)],
    ['the talk key', (c: ListenController) => c.hold()],
    ['the bubble cancelled', (c: ListenController) => c.cancel()],
    ['switching off', (c: ListenController) => c.setAlways(false)],
    ['closing it', (c: ListenController) => c.closeFollowUp()],
  ])('closes on %s', async (_why, close) => {
    const { controller, ears, calls, onFollowUp, timers } = await inWindow();
    close(controller);
    expect(onFollowUp).toHaveBeenLastCalledWith(false);
    expect(timers.pending()).not.toContain(20_000);
    controller.cancel();
    controller.setPaused(false);
    controller.setAlways(true);
    await tick();
    ears.say('turnEnd', 'and tomorrow?');
    expect(calls.heard).not.toHaveBeenCalledWith('and tomorrow?');
  });

  it('never opens while listening is off or paused', async () => {
    const onFollowUp = vi.fn();
    const { controller } = setup(undefined, { onFollowUp });
    controller.openFollowUp();
    controller.setAlways(true);
    controller.setPaused(true);
    controller.openFollowUp();
    expect(onFollowUp).not.toHaveBeenCalled();
  });

  it('a plain "stop" closes the window without switching listening off or being asked', async () => {
    const { ears, calls, onFollowUp } = await inWindow();
    ears.say('turnEnd', 'Stop.');
    expect(calls.stop).not.toHaveBeenCalled();
    expect(calls.heard).not.toHaveBeenCalled();
    expect(onFollowUp).toHaveBeenLastCalledWith(false);
  });

  it('"Scout, stop" in the window still switches listening off', async () => {
    const { ears, calls } = await inWindow();
    ears.say('turnEnd', 'Scout, stop.');
    expect(calls.stop).toHaveBeenCalledOnce();
    expect(calls.heard).not.toHaveBeenCalled();
  });
});

describe('ListenController, a question without the name', () => {
  it('says so, without its words, for three words or more', async () => {
    const onUnaddressed = vi.fn();
    const { controller, ears } = setup(undefined, { onUnaddressed });
    controller.setAlways(true);
    await tick();
    ears.say('turnEnd', 'yes please');
    expect(onUnaddressed).not.toHaveBeenCalled();
    ears.say('turnEnd', 'what is this error');
    expect(onUnaddressed).toHaveBeenCalledExactlyOnceWith();
    ears.say('turnEnd', 'Scout, what is this error');
    expect(onUnaddressed).toHaveBeenCalledOnce();
  });

  it('is quiet in the follow-up window', async () => {
    const onUnaddressed = vi.fn();
    const first = setup(undefined, { onUnaddressed });
    first.controller.setAlways(true);
    await tick();
    first.controller.openFollowUp();
    first.ears.say('turnEnd', 'what is this error');
    expect(onUnaddressed).not.toHaveBeenCalled();
  });
});
