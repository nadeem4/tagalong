/** Tests for VoiceWorker. */

import { describe, expect, it, vi } from 'vitest';
import { VoiceWorker } from './client';
import type { FromWorker, ToWorker, WorkerProcess } from './messages';

function fakeProcess() {
  const sent: ToWorker[] = [];
  const handlers = {
    message: [] as ((m: FromWorker) => void)[],
    exit: [] as ((c: number) => void)[],
  };
  const child: WorkerProcess = {
    postMessage: (message) => void sent.push(message),
    on: ((event: 'message' | 'exit', listener: never) => {
      handlers[event].push(listener);
    }) as WorkerProcess['on'],
    kill: () => true,
  };
  return {
    child,
    sent,
    reply: (message: FromWorker) => handlers.message.forEach((h) => h(message)),
    exit: () => handlers.exit.forEach((h) => h(1)),
  };
}

describe('VoiceWorker', () => {
  it('starts the process on first use and matches each answer to its call', async () => {
    const proc = fakeProcess();
    const spawn = vi.fn(() => proc.child);
    const worker = new VoiceWorker(spawn);
    expect(spawn).not.toHaveBeenCalled();

    const first = worker.call({ kind: 'call', method: 'kokoro.warm' });
    const second = worker.call({ kind: 'call', method: 'kokoro.warm' });
    expect(proc.sent.map((m) => (m.kind === 'call' ? m.id : 0))).toEqual([1, 2]);
    proc.reply({ kind: 'result', id: 2, value: 'b' });
    proc.reply({ kind: 'error', id: 1, message: 'no model' });
    await expect(second).resolves.toBe('b');
    await expect(first).rejects.toThrow('no model');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('passes other messages to listeners', () => {
    const proc = fakeProcess();
    const worker = new VoiceWorker(() => proc.child);
    const seen: FromWorker[] = [];
    worker.onMessage((m) => seen.push(m));
    worker.call({ kind: 'call', method: 'kokoro.warm' }).catch(() => undefined);
    proc.reply({ kind: 'kokoro.ready' });
    expect(seen).toEqual([{ kind: 'kokoro.ready' }]);
  });

  it("logs the voice process's warnings and errors in main, not to listeners", () => {
    const proc = fakeProcess();
    const worker = new VoiceWorker(() => proc.child);
    const seen: FromWorker[] = [];
    worker.onMessage((m) => seen.push(m));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      worker.call({ kind: 'call', method: 'kokoro.warm' }).catch(() => undefined);
      proc.reply({ kind: 'log', level: 'warn', text: '[ears] the models could not load' });
      proc.reply({ kind: 'log', level: 'error', text: '[voice] boom' });
      expect(warn).toHaveBeenCalledWith('[voice process] [ears] the models could not load');
      expect(error).toHaveBeenCalledWith('[voice process] [voice] boom');
      expect(seen).toEqual([]);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('rejects every pending call when the process dies, tells listeners, and starts afresh next time', async () => {
    const procs = [fakeProcess(), fakeProcess()];
    let spawned = 0;
    const worker = new VoiceWorker(() => procs[spawned++]!.child);
    const exited = vi.fn();
    worker.onExit(exited);

    const pending = worker.call({ kind: 'call', method: 'kokoro.warm' });
    procs[0]!.exit();
    await expect(pending).rejects.toThrow('The voice process stopped.');
    expect(exited).toHaveBeenCalledOnce();

    const again = worker.call({ kind: 'call', method: 'kokoro.warm' });
    expect(spawned).toBe(2);
    procs[1]!.reply({ kind: 'result', id: 2, value: true });
    await expect(again).resolves.toBe(true);
  });
});
