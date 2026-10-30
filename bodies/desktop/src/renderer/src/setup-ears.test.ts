/** Tests for setupEars and micFailure. */
import { describe, expect, it, vi } from 'vitest';
import type { Ears, EarsEvent, ListenMode, MicStream } from '@tagalong/protocol';
import type { ListenMic } from '@tagalong/ui';
import type { EarsStatus } from '../../shared/ipc';
import { micFailure, setupEars } from './setup-ears';
import type { SetupEarsDeps } from './setup-ears';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakeMic = (close = vi.fn()): ListenMic & { close: typeof close } =>
  Object.assign((async function* () {})(), { close });

/** Every ears made hears the one stream of events, as each window does from main. */
function fakeEars() {
  const handlers = new Map<EarsEvent, Set<(text?: string) => void>>();
  const made: { mode: ListenMode; ears: Ears & { listening: MicStream | null; stops: number } }[] =
    [];
  const make = (mode: ListenMode) => {
    const ears = {
      listening: null as MicStream | null,
      stops: 0,
      listen(mic: MicStream) {
        this.listening = mic;
      },
      stop() {
        this.stops += 1;
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

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<Pick<SetupEarsDeps, 'openMic' | 'ensureEars'>> = {}) {
  const ears = fakeEars();
  const mics: ReturnType<typeof fakeMic>[] = [];
  let status: ((status: EarsStatus) => void) | undefined;
  let systemVoice: ((speaking: boolean) => void) | undefined;
  const unsubscribed = { status: vi.fn(), systemVoice: vi.fn() };
  const deps = {
    ears: vi.fn(ears.make),
    openMic: vi.fn(
      overrides.openMic ??
        (async () => {
          const mic = fakeMic();
          mics.push(mic);
          return mic;
        }),
    ),
    ensureEars: vi.fn(overrides.ensureEars ?? (async () => undefined)),
    onEarsStatus: (handler: (status: EarsStatus) => void) => {
      status = handler;
      return unsubscribed.status;
    },
    onSystemVoice: (listener: (speaking: boolean) => void) => {
      systemVoice = listener;
      return unsubscribed.systemVoice;
    },
    onHeard: vi.fn(),
    onSpeechStart: vi.fn(),
    onState: vi.fn(),
    onFailure: vi.fn(),
  };
  const made = setupEars(deps);
  return {
    made,
    deps,
    ears,
    mics,
    unsubscribed,
    status: (s: EarsStatus) => status?.(s),
    systemVoice: (speaking: boolean) => systemVoice?.(speaking),
  };
}

/** Starts listening and waits until the mic is open. */
async function listening(t: ReturnType<typeof setup>) {
  t.made.start();
  await tick();
  await tick();
  expect(t.mics).toHaveLength(1);
}

describe('setupEars', () => {
  it('opens the mic only after the speech model is ready, then hears every answer whole', async () => {
    const model = deferred();
    let progress: ((fraction: number) => void) | undefined;
    const t = setup({
      ensureEars: (onProgress) => {
        progress = onProgress;
        return model.promise;
      },
    });
    t.made.start();
    progress?.(0.4);
    await tick();
    expect(t.deps.openMic).not.toHaveBeenCalled();
    expect(t.deps.onState.mock.calls).toEqual([[0], [0.4]]);
    model.resolve();
    await tick();
    await tick();
    expect(t.deps.onState).toHaveBeenLastCalledWith(null);
    expect(t.deps.openMic).toHaveBeenCalledOnce();
    expect(t.ears.made.map((m) => m.mode)).toEqual(['always']);
    t.ears.say('turnEnd', 'Claude');
    expect(t.deps.onHeard).toHaveBeenCalledExactlyOnceWith('Claude');
  });

  it('stops Scout talking the moment you start', async () => {
    const t = setup();
    await listening(t);
    t.ears.say('partial', 'Cla');
    expect(t.deps.onSpeechStart).toHaveBeenCalledOnce();
  });

  it('closes the mic after "I\'ll type", and hears nothing after', async () => {
    const t = setup();
    await listening(t);
    t.made.stop();
    await tick();
    expect(t.mics[0]?.close).toHaveBeenCalledOnce();
    expect(t.ears.made[0]?.ears.stops).toBe(1);
    expect(t.deps.onState).toHaveBeenLastCalledWith('off');
    t.ears.say('turnEnd', 'type');
    expect(t.deps.onHeard).not.toHaveBeenCalled();
  });

  it('closes the mic and lets go of everything after setup finishes', async () => {
    const t = setup();
    await listening(t);
    t.made.dispose();
    await tick();
    expect(t.mics[0]?.close).toHaveBeenCalledOnce();
    expect(t.unsubscribed.status).toHaveBeenCalledOnce();
    expect(t.unsubscribed.systemVoice).toHaveBeenCalledOnce();
  });

  it("ignores other windows' ears events before it starts, while downloading and after it stops", async () => {
    const model = deferred();
    const t = setup({ ensureEars: () => model.promise });
    t.ears.say('turnEnd', 'before');
    t.made.start();
    t.ears.say('turnEnd', 'downloading');
    model.resolve();
    await tick();
    await tick();
    t.made.stop();
    t.ears.say('turnEnd', 'after');
    expect(t.deps.onHeard).not.toHaveBeenCalled();
  });

  it('never opens the mic when stopped during the download', async () => {
    const model = deferred();
    let progress: ((fraction: number) => void) | undefined;
    const t = setup({
      ensureEars: (onProgress) => {
        progress = onProgress;
        return model.promise;
      },
    });
    t.made.start();
    t.made.stop();
    progress?.(0.7);
    model.resolve();
    await tick();
    await tick();
    expect(t.deps.openMic).not.toHaveBeenCalled();
    expect(t.deps.onState).toHaveBeenLastCalledWith('off');
  });

  it('reports a refused microphone, and never opens it again', async () => {
    const t = setup({ openMic: () => Promise.reject({ name: 'NotAllowedError' }) });
    t.made.start();
    await tick();
    await tick();
    expect(t.deps.onFailure).toHaveBeenCalledExactlyOnceWith('denied');
    expect(t.deps.onState).toHaveBeenLastCalledWith('off');
    t.systemVoice(true);
    t.systemVoice(false);
    await tick();
    expect(t.deps.openMic).toHaveBeenCalledOnce();
  });

  it('reports no microphone, and never opens it again', async () => {
    const t = setup({ openMic: () => Promise.reject({ name: 'NotFoundError' }) });
    t.made.start();
    await tick();
    await tick();
    expect(t.deps.onFailure).toHaveBeenCalledExactlyOnceWith('no-mic');
    t.systemVoice(false);
    await tick();
    expect(t.deps.openMic).toHaveBeenCalledOnce();
  });

  it('reports a speech model that failed to download, without opening the mic', async () => {
    const t = setup({ ensureEars: () => Promise.reject(new Error('offline')) });
    t.made.start();
    await tick();
    expect(t.deps.onFailure).toHaveBeenCalledExactlyOnceWith('model-failed');
    expect(t.deps.onState).toHaveBeenLastCalledWith('off');
    t.systemVoice(false);
    await tick();
    expect(t.deps.openMic).not.toHaveBeenCalled();
  });

  it('closes the mic when the model fails while listening, and ignores it while off', async () => {
    const t = setup();
    t.status({ status: 'failed' });
    expect(t.deps.onFailure).not.toHaveBeenCalled();
    await listening(t);
    t.status({ status: 'loading' });
    expect(t.deps.onFailure).not.toHaveBeenCalled();
    t.status({ status: 'failed' });
    await tick();
    expect(t.deps.onFailure).toHaveBeenCalledExactlyOnceWith('model-failed');
    expect(t.mics[0]?.close).toHaveBeenCalledOnce();
    t.systemVoice(false);
    await tick();
    expect(t.deps.openMic).toHaveBeenCalledOnce();
  });

  it('closes the mic while the system voice speaks and opens it again after', async () => {
    const t = setup();
    await listening(t);
    t.systemVoice(true);
    await tick();
    expect(t.mics[0]?.close).toHaveBeenCalledOnce();
    t.systemVoice(false);
    await tick();
    expect(t.deps.openMic).toHaveBeenCalledTimes(2);
  });

  it('starts once, however often it is asked', async () => {
    const t = setup();
    await listening(t);
    t.made.start();
    await tick();
    expect(t.deps.ensureEars).toHaveBeenCalledOnce();
    expect(t.deps.openMic).toHaveBeenCalledOnce();
  });
});

describe('micFailure', () => {
  it('reads a refused permission as denied, anything else as no microphone', () => {
    expect(micFailure({ name: 'NotAllowedError' })).toBe('denied');
    expect(micFailure({ name: 'SecurityError' })).toBe('denied');
    expect(micFailure({ name: 'NotFoundError' })).toBe('no-mic');
    expect(micFailure(new Error('x'))).toBe('no-mic');
  });

  it('reads a microphone another app holds as busy, not missing', () => {
    expect(micFailure({ name: 'NotReadableError' })).toBe('busy');
    expect(micFailure({ name: 'AbortError' })).toBe('busy');
    expect(micFailure({ name: 'OverconstrainedError' })).toBe('no-mic');
  });
});
