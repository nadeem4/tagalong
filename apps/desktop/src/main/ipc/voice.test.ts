import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { AlwaysListening } from '../always-listening';
import type { FromWorker } from '../voice/worker/messages';
import { fakeIpc } from './fake-ipc';
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
    expect(await invoke(IPC.getListening)).toEqual({ on: false, paused: false });
    expect(await invoke(IPC.setListening, true)).toEqual({ on: true, paused: false });
    await expect(invoke(IPC.setListening, 'yes')).rejects.toThrow('on or off');
    expect(await invoke(IPC.getListening)).toEqual({ on: true, paused: false });
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
