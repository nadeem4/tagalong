/** Tests for the voice-models IPC: Settings reads and picks the speech models through the brain's Home tools. */

import { describe, expect, it } from 'vitest';
import { IPC } from '../../shared/ipc';
import { fakeIpc } from './fake-ipc';
import { registerVoiceModelsIpc, startVoiceFetch } from './voice-models';

const text = (value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }];

const STATE = {
  live: 'auto',
  final: 'auto',
  models: [
    {
      id: 'moonshine-tiny',
      label: 'Moonshine tiny',
      role: 'live',
      size_mb: 45,
      gpu: 'none',
      languages: ['en'],
      note: '',
    },
  ],
  gpu_name: null,
};

const DOWNLOAD = { status: 'downloading', progress: 0.5 };

function setup() {
  const ipc = fakeIpc();
  const calls: [string, object | undefined][] = [];
  const brain = {
    call: (tool: string, input?: object) => {
      calls.push([tool, input]);
      const answer = tool === 'stt_state' ? STATE : tool === 'voice_download' ? DOWNLOAD : {};
      return Promise.resolve(text(answer)) as Promise<never>;
    },
  };
  registerVoiceModelsIpc(ipc.handle, { brain });
  return { ...ipc, calls };
}

describe('registerVoiceModelsIpc', () => {
  it('reads the state and parses it', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.sttState)).toEqual(STATE);
    expect(calls).toEqual([['stt_state', {}]]);
  });

  it('reads how far the voice download has got', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.voiceDownload)).toEqual(DOWNLOAD);
    expect(calls).toEqual([['voice_download', {}]]);
  });

  it('starts the voice fetch, or retries it', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.voiceFetch, false);
    await invoke(IPC.voiceFetch, true);
    expect(calls).toEqual([
      ['fetch_voice', {}],
      ['fetch_voice', { retry: true }],
    ]);
  });

  it('passes the picked models to set_stt', async () => {
    const { invoke, calls } = setup();
    await invoke(IPC.sttSet, { live: 'moonshine-tiny' });
    await invoke(IPC.sttSet, { final: 'off' });
    expect(calls).toEqual([
      ['set_stt', { live: 'moonshine-tiny' }],
      ['set_stt', { final: 'off' }],
    ]);
  });

  it('refuses an empty pick or an odd one before the brain hears of it', async () => {
    const { invoke, calls } = setup();
    for (const bad of [{}, { live: '' }, { final: 5 }, undefined, null, 'auto']) {
      await expect(invoke(IPC.sttSet, bad)).rejects.toThrow();
    }
    expect(calls).toEqual([]);
  });
});

describe('startVoiceFetch', () => {
  it('asks the brain to fetch the voice, and never throws when it cannot', async () => {
    const calls: string[] = [];
    await startVoiceFetch({
      call: (tool: string) => (calls.push(tool), Promise.resolve(text({}))) as Promise<never>,
    });
    await expect(
      startVoiceFetch({ call: () => Promise.reject(new Error('offline')) }),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(['fetch_voice']);
  });
});
