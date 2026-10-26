/** Tests for the voice IPC, forwarding the ears and the model check. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { EARS_FILES } from '../voice/ears/model-files';
import { KOKORO_MODEL } from '../voice/kokoro';
import { AlwaysListening } from '../always-listening';
import { VoiceWorker } from '../voice/worker/client';
import type { FromWorker, ToWorker, WorkerProcess } from '../voice/worker/messages';
import { fakeIpc } from './fake-ipc';
import { StatusMarks } from '../status-marks';
import { forwardEars, registerVoiceIpc } from './voice';

function setup(noteActiveWindow: () => Promise<unknown> = () => Promise.resolve()) {
  const ipc = fakeIpc();
  const voice = { speak: vi.fn(() => Promise.resolve({ kind: 'off' as const })) };
  const worker = { send: vi.fn(), call: vi.fn(async () => true as unknown) };
  const listening = new AlwaysListening();
  registerVoiceIpc(ipc.handle, {
    voice: () => voice,
    worker: () => worker,
    noteActiveWindow,
    listening: () => listening,
    on: ipc.on,
  });
  return { ...ipc, voice, worker, listening };
}

describe('registerVoiceIpc', () => {
  it('speaks only the line, as a string', async () => {
    const { invoke, voice } = setup();
    expect(await invoke(IPC.speak, 42, { voice: 'af_heart' })).toEqual({ kind: 'off' });
    expect(voice.speak).toHaveBeenCalledWith('42', { voice: 'af_heart' });
  });

  it('notes the window for a held question, then starts listening in the voice process', async () => {
    const order: string[] = [];
    const { invoke, worker } = setup(async () => void order.push('note'));
    worker.send.mockImplementation(() => void order.push('listen'));
    await invoke(IPC.earsListen, 'held');
    expect(order).toEqual(['note', 'listen']);
    expect(worker.send).toHaveBeenCalledWith({ kind: 'ears.listen', mode: 'held' });
  });

  it('still listens when the window could not be noted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { invoke, worker } = setup(() => Promise.reject(new Error('no window')));
    await invoke(IPC.earsListen, 'held');
    expect(worker.send).toHaveBeenCalledWith({ kind: 'ears.listen', mode: 'held' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ensures the ears’ models through the voice process and resolves with nothing', async () => {
    const { invoke, worker } = setup();
    expect(await invoke(IPC.ensureEars)).toBeUndefined();
    expect(worker.call).toHaveBeenCalledWith({ kind: 'call', method: 'ears.ensure' });
  });

  it('refuses a mode it does not know, rather than guessing', async () => {
    const { invoke, worker } = setup();
    await expect(invoke(IPC.earsListen, 'forever')).rejects.toThrow('listening mode');
    expect(worker.send).not.toHaveBeenCalled();
  });

  it('forwards each mic frame as Float32Array, and stop', async () => {
    const { send, invoke, worker } = setup();
    send(IPC.micFrame, [0.5, 0.25]);
    await Promise.resolve();
    expect(worker.send).toHaveBeenCalledWith({
      kind: 'ears.frame',
      samples: new Float32Array([0.5, 0.25]),
    });
    await invoke(IPC.earsStop);
    expect(worker.send).toHaveBeenLastCalledWith({ kind: 'ears.stop' });
  });

  it('keeps frames and stop behind a listen still noting the window', async () => {
    let noted!: () => void;
    const { invoke, send, worker } = setup(() => new Promise<void>((resolve) => (noted = resolve)));
    const listening = invoke(IPC.earsListen, 'held');
    send(IPC.micFrame, new Float32Array([0.1]));
    const stopping = invoke(IPC.earsStop);
    await Promise.resolve();
    expect(worker.send).not.toHaveBeenCalled();
    noted();
    await Promise.all([listening, stopping]);
    expect(worker.send.mock.calls.map(([message]) => (message as { kind: string }).kind)).toEqual([
      'ears.listen',
      'ears.frame',
      'ears.stop',
    ]);
  });

  it('switches Always listening only when asked, with a boolean', async () => {
    const { invoke } = setup();
    expect(await invoke(IPC.getListening)).toEqual({ on: false, paused: false, followUp: false });
    expect(await invoke(IPC.setListening, true)).toEqual({
      on: true,
      paused: false,
      followUp: false,
    });
    await expect(invoke(IPC.setListening, 'yes')).rejects.toThrow('on or off');
    expect(await invoke(IPC.getListening)).toEqual({ on: true, paused: false, followUp: false });
  });
});

describe('registerVoiceIpc, the follow-up window', () => {
  it('takes the panel’s follow-up window, with a boolean, only while listening is on', async () => {
    const { invoke, listening } = setup();
    await invoke(IPC.setFollowUp, true);
    expect(listening.state.followUp).toBe(false);
    listening.set(true);
    await invoke(IPC.setFollowUp, true);
    expect(listening.state.followUp).toBe(true);
    await expect(invoke(IPC.setFollowUp, 'yes')).rejects.toThrow('open or closed');
    await invoke(IPC.setFollowUp, false);
    expect(listening.state.followUp).toBe(false);
  });
});

describe('a voice process that dies mid-question', () => {
  it('tells the panel, and the next talk press starts a fresh process listening', async () => {
    const processes: { sent: ToWorker[]; die: () => void }[] = [];
    const worker = new VoiceWorker(() => {
      const sent: ToWorker[] = [];
      const exits: (() => void)[] = [];
      processes.push({ sent, die: () => exits.forEach((exit) => exit()) });
      return {
        postMessage: (message: ToWorker) => void sent.push(message),
        on: ((event: string, listener: () => void) => {
          if (event === 'exit') exits.push(listener);
        }) as WorkerProcess['on'],
        kill: () => true,
      };
    });
    const ipc = fakeIpc();
    registerVoiceIpc(ipc.handle, {
      voice: () => ({ speak: vi.fn() }),
      worker: () => worker,
      noteActiveWindow: () => Promise.resolve(),
      listening: () => new AlwaysListening(),
      on: ipc.on,
    });
    const statuses: unknown[] = [];
    forwardEars(worker, (channel, payload) => {
      if (channel === IPC.earsStatusEvent) statuses.push(payload);
    });

    await ipc.invoke(IPC.earsListen, 'held');
    processes[0]!.die();
    expect(statuses).toEqual([
      { status: 'failed', message: 'Listening stopped unexpectedly. Try again.' },
    ]);

    await ipc.invoke(IPC.earsListen, 'held');
    expect(processes).toHaveLength(2);
    expect(processes[1]!.sent).toEqual([{ kind: 'ears.listen', mode: 'held' }]);
  });
});

describe('forwardEars', () => {
  it('sends the ears’ events and status to the panel, and says listening failed if the process dies', () => {
    const listeners: ((m: FromWorker) => void)[] = [];
    const exits: (() => void)[] = [];
    const sent: [string, unknown][] = [];
    forwardEars(
      {
        onMessage: (l) => (listeners.push(l), () => undefined),
        onExit: (l) => (exits.push(l), () => undefined),
      },
      (channel, payload) => void sent.push([channel, payload]),
    );
    listeners.forEach((l) => l({ kind: 'ears', event: 'partial', text: 'what' }));
    listeners.forEach((l) => l({ kind: 'ears', event: 'speechStart' }));
    listeners.forEach((l) => l({ kind: 'ears.status', status: 'loading' }));
    listeners.forEach((l) => l({ kind: 'ears.status', status: 'failed', message: 'offline' }));
    listeners.forEach((l) => l({ kind: 'ears.progress', fraction: 0.25 }));
    listeners.forEach((l) => l({ kind: 'kokoro.ready' }));
    exits.forEach((l) => l());
    expect(sent).toEqual([
      [IPC.earsEvent, { event: 'partial', text: 'what' }],
      [IPC.earsEvent, { event: 'speechStart' }],
      [IPC.earsStatusEvent, { status: 'loading' }],
      [IPC.earsStatusEvent, { status: 'failed', message: 'offline' }],
      [IPC.earsProgressEvent, { fraction: 0.25 }],
      [
        IPC.earsStatusEvent,
        { status: 'failed', message: 'Listening stopped unexpectedly. Try again.' },
      ],
    ]);
  });

  it('in the follow-up window, any words bring the bubble up, but a plain "stop" does not', () => {
    const listeners: ((m: FromWorker) => void)[] = [];
    const onSpoken = vi.fn();
    let followUp = true;
    forwardEars(
      { onMessage: (l) => (listeners.push(l), () => undefined), onExit: () => () => undefined },
      () => undefined,
      onSpoken,
      { followUp: () => followUp },
    );
    listeners.forEach((l) => l({ kind: 'ears', event: 'turnEnd', text: 'stop' }));
    expect(onSpoken).not.toHaveBeenCalled();
    listeners.forEach((l) => l({ kind: 'ears', event: 'turnEnd', text: 'and tomorrow?' }));
    expect(onSpoken).toHaveBeenCalledOnce();
    followUp = false;
    listeners.forEach((l) => l({ kind: 'ears', event: 'turnEnd', text: 'and tomorrow?' }));
    expect(onSpoken).toHaveBeenCalledOnce();
    listeners.forEach((l) => l({ kind: 'ears', event: 'turnEnd', text: 'Scott, and tomorrow?' }));
    expect(onSpoken).toHaveBeenCalledTimes(2);
  });

  it('shows the speech models download and an ears failure on Scout until they are ready', () => {
    const listeners: ((m: FromWorker) => void)[] = [];
    const exits: (() => void)[] = [];
    const marks = new StatusMarks();
    forwardEars(
      {
        onMessage: (l) => (listeners.push(l), () => undefined),
        onExit: (l) => (exits.push(l), () => undefined),
      },
      () => undefined,
      undefined,
      { marks },
    );
    const say = (m: FromWorker) => listeners.forEach((l) => l(m));
    say({ kind: 'ears.status', status: 'loading' });
    expect(marks.top()).toEqual({ id: 'ears-loading' });
    say({ kind: 'ears.progress', fraction: 0.4 });
    expect(marks.top()).toEqual({ id: 'ears-loading', percent: 40 });
    say({ kind: 'ears.status', status: 'failed', message: 'offline' });
    expect(marks.top()).toEqual({ id: 'ears-failed' });
    say({ kind: 'ears.status', status: 'ready' });
    expect(marks.top()).toBeNull();
    say({ kind: 'ears.progress', fraction: 0.5 });
    say({ kind: 'ears.progress', fraction: 1 });
    expect(marks.top()).toBeNull();
    exits.forEach((l) => l());
    expect(marks.top()).toEqual({ id: 'ears-failed' });
  });

  it('a voice process that only spoke and then stopped is not an ears failure', () => {
    const exits: (() => void)[] = [];
    const marks = new StatusMarks();
    forwardEars(
      { onMessage: () => () => undefined, onExit: (l) => (exits.push(l), () => undefined) },
      () => undefined,
      undefined,
      { marks },
    );
    exits.forEach((l) => l());
    expect(marks.top()).toBeNull();
  });

  it('brings the bubble up only for words addressed to Scout, never for bare speech', () => {
    const listeners: ((m: FromWorker) => void)[] = [];
    const onSpoken = vi.fn();
    forwardEars(
      { onMessage: (l) => (listeners.push(l), () => undefined), onExit: () => () => undefined },
      () => undefined,
      onSpoken,
    );
    listeners.forEach((l) => l({ kind: 'ears', event: 'speechStart' }));
    listeners.forEach((l) => l({ kind: 'ears', event: 'partial', text: 'what' }));
    listeners.forEach((l) => l({ kind: 'ears', event: 'turnEnd', text: 'what is Scout doing' }));
    expect(onSpoken).not.toHaveBeenCalled();
    listeners.forEach((l) => l({ kind: 'ears', event: 'partial', text: 'Scout, what' }));
    expect(onSpoken).toHaveBeenCalledOnce();
  });

  it('a partial "Scout, st" might still be "stop", so the bubble stays down', () => {
    const listeners: ((m: FromWorker) => void)[] = [];
    const onSpoken = vi.fn();
    forwardEars(
      { onMessage: (l) => (listeners.push(l), () => undefined), onExit: () => () => undefined },
      () => undefined,
      onSpoken,
    );
    listeners.forEach((l) => l({ kind: 'ears', event: 'partial', text: 'Scout, st' }));
    expect(onSpoken).not.toHaveBeenCalled();
    listeners.forEach((l) => l({ kind: 'ears', event: 'partial', text: 'Scout, sta' }));
    expect(onSpoken).toHaveBeenCalledOnce();
  });

  it('"Scout, stop" switches listening off without bringing the bubble up', () => {
    const listeners: ((m: FromWorker) => void)[] = [];
    const onSpoken = vi.fn();
    const sent: [string, unknown][] = [];
    forwardEars(
      { onMessage: (l) => (listeners.push(l), () => undefined), onExit: () => () => undefined },
      (channel, payload) => void sent.push([channel, payload]),
      onSpoken,
    );
    listeners.forEach((l) => l({ kind: 'ears', event: 'partial', text: 'Scout, stop' }));
    listeners.forEach((l) => l({ kind: 'ears', event: 'turnEnd', text: 'Scout, stop listening.' }));
    expect(onSpoken).not.toHaveBeenCalled();
    // The panel still hears it, and switches listening off.
    expect(sent).toHaveLength(2);
  });
});

describe('voiceModels, for the health check', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function withVoiceDir() {
    const dir = mkdtempSync(join(tmpdir(), 'tagalong-voice-'));
    dirs.push(dir);
    const ipc = fakeIpc();
    registerVoiceIpc(ipc.handle, {
      voice: () => ({ speak: vi.fn() }),
      worker: () => ({ send: vi.fn(), call: vi.fn() }),
      noteActiveWindow: () => Promise.resolve(),
      listening: () => new AlwaysListening(),
      on: ipc.on,
      voiceDir: () => dir,
    });
    return { dir, invoke: ipc.invoke };
  }

  const place = (dir: string, path: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), 'x');
  };

  it('says neither model is downloaded in an empty voice folder, and fetches nothing', async () => {
    const { invoke } = withVoiceDir();
    expect(await invoke(IPC.voiceModels)).toEqual({ mouth: false, ears: false });
  });

  it('says the mouth and the ears are there once their files are', async () => {
    const { dir, invoke } = withVoiceDir();
    place(dir, `${KOKORO_MODEL}/onnx/model_quantized.onnx`);
    expect(await invoke(IPC.voiceModels)).toEqual({ mouth: true, ears: false });
    for (const file of EARS_FILES) place(dir, file.path);
    expect(await invoke(IPC.voiceModels)).toEqual({ mouth: true, ears: true });
  });

  it('counts the ears as missing while any one file is', async () => {
    const { dir, invoke } = withVoiceDir();
    for (const file of EARS_FILES.slice(1)) place(dir, file.path);
    expect(await invoke(IPC.voiceModels)).toEqual({ mouth: false, ears: false });
  });
});
