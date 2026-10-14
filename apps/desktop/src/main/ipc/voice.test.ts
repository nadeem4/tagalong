import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerVoiceIpc } from './voice';

function setup(noteActiveWindow: () => Promise<unknown> = () => Promise.resolve()) {
  const ipc = fakeIpc();
  const voice = { speak: vi.fn(() => Promise.resolve({ kind: 'off' as const })) };
  const listen = {
    prepare: vi.fn(() => ({ ready: true })),
    transcribe: vi.fn(() => Promise.resolve({ kind: 'text' as const, text: 'hello' })),
  };
  registerVoiceIpc(ipc.handle, {
    voice: () => voice,
    listen: () => listen,
    noteActiveWindow,
  });
  return { ...ipc, voice, listen };
}

describe('registerVoiceIpc', () => {
  it('speaks only the line, as a string', async () => {
    const { invoke, voice } = setup();
    expect(await invoke(IPC.speak, 42, { voice: 'af_heart' })).toEqual({ kind: 'off' });
    expect(voice.speak).toHaveBeenCalledWith('42', { voice: 'af_heart' });
  });

  it('notes the window, then starts loading the speech model', async () => {
    const order: string[] = [];
    const { invoke, listen } = setup(() => {
      order.push('note');
      return Promise.resolve();
    });
    listen.prepare.mockImplementation(() => {
      order.push('prepare');
      return { ready: true };
    });
    expect(await invoke(IPC.prepareListening)).toEqual({ ready: true });
    expect(order).toEqual(['note', 'prepare']);
  });

  it('still prepares when the window could not be noted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { invoke } = setup(() => Promise.reject(new Error('no window')));
    expect(await invoke(IPC.prepareListening)).toEqual({ ready: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('transcribes the samples, turning a copied array back into Float32Array', async () => {
    const { invoke, listen } = setup();
    const samples = new Float32Array([0.1, 0.2]);
    expect(await invoke(IPC.transcribe, samples)).toEqual({ kind: 'text', text: 'hello' });
    expect(listen.transcribe).toHaveBeenLastCalledWith(samples);

    await invoke(IPC.transcribe, [0.5, 0.25]);
    expect(listen.transcribe).toHaveBeenLastCalledWith(new Float32Array([0.5, 0.25]));
  });
});
