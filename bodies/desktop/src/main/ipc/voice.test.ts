/** Tests for the voice IPC: the mic and listen on their way to the brain, and what comes back. */

import { BrainOffline } from '@tagalong/contract';
import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../shared/ipc';
import { AlwaysListening } from '../always-listening';
import { StatusMarks } from '../status-marks';
import { fakeIpc } from './fake-ipc';
import { createVoiceBridge, registerVoiceIpc } from './voice';

function fakeBrain() {
  return {
    listen: vi.fn(() => Promise.resolve()),
    mic: vi.fn(() => true),
    unlisten: vi.fn(),
    hush: vi.fn(),
    call: vi.fn(),
  };
}

function setup(
  noteActiveWindow: () => Promise<unknown> = () => Promise.resolve(),
  more: { onSpoken?: () => void; followUp?: () => boolean; marks?: StatusMarks } = {},
) {
  const ipc = fakeIpc();
  const brain = fakeBrain();
  const sent: [string, unknown][] = [];
  const bridge = createVoiceBridge({
    brain,
    send: (channel, payload) => void sent.push([channel, payload]),
    ...more,
  });
  const listening = new AlwaysListening();
  registerVoiceIpc(ipc.handle, {
    bridge,
    brain,
    noteActiveWindow,
    listening: () => listening,
    on: ipc.on,
  });
  return { ...ipc, brain, bridge, listening, sent };
}

describe('registerVoiceIpc', () => {
  it('notes the window for a held question, then asks the brain to listen', async () => {
    const order: string[] = [];
    const { invoke, brain } = setup(async () => void order.push('note'));
    brain.listen.mockImplementation(() => (order.push('listen'), Promise.resolve()));
    await invoke(IPC.earsListen, 'held');
    expect(order).toEqual(['note', 'listen']);
    expect(brain.listen).toHaveBeenCalledWith('held');
  });

  it('still listens when the window could not be noted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { invoke, brain } = setup(() => Promise.reject(new Error('no window')));
    await invoke(IPC.earsListen, 'held');
    expect(brain.listen).toHaveBeenCalledWith('held');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses a mode it does not know, rather than guessing', async () => {
    const { invoke, brain } = setup();
    await expect(invoke(IPC.earsListen, 'forever')).rejects.toThrow('listening mode');
    expect(brain.listen).not.toHaveBeenCalled();
  });

  it('sends each mic frame as clamped 16-bit samples, and stop as unlisten', async () => {
    const { send, invoke, brain } = setup();
    send(IPC.micFrame, [0.5, -1, 2, 0]);
    await Promise.resolve();
    await Promise.resolve();
    expect(brain.mic).toHaveBeenCalledWith(new Int16Array([16384, -32768, 32767, 0]));
    await invoke(IPC.earsStop);
    expect(brain.unlisten).toHaveBeenCalledOnce();
  });

  it('keeps frames and stop behind a listen still noting the window', async () => {
    let noted!: () => void;
    const { invoke, send, brain } = setup(() => new Promise<void>((resolve) => (noted = resolve)));
    const calls: string[] = [];
    brain.listen.mockImplementation(() => (calls.push('listen'), Promise.resolve()));
    brain.mic.mockImplementation(() => (calls.push('mic'), true));
    brain.unlisten.mockImplementation(() => void calls.push('unlisten'));
    const listening = invoke(IPC.earsListen, 'held');
    send(IPC.micFrame, new Float32Array([0.1]));
    const stopping = invoke(IPC.earsStop);
    await Promise.resolve();
    expect(calls).toEqual([]);
    noted();
    await Promise.all([listening, stopping]);
    expect(calls).toEqual(['listen', 'mic', 'unlisten']);
  });

  it('says listening failed, in the desktop’s words, when the brain is not reachable', async () => {
    const { invoke, brain, sent } = setup();
    brain.listen.mockRejectedValue(new BrainOffline());
    await expect(invoke(IPC.earsListen, 'always')).resolves.toBeUndefined();
    expect(sent).toEqual([
      [IPC.earsStatusEvent, { status: 'failed', message: expect.stringContaining('brain') }],
    ]);
  });

  it('hushes the brain on the panel’s say-so', async () => {
    const { invoke, brain } = setup();
    await invoke(IPC.hush);
    expect(brain.hush).toHaveBeenCalledOnce();
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
  });

  it('takes the panel’s follow-up window, with a boolean, only while listening is on', async () => {
    const { invoke, listening } = setup();
    await invoke(IPC.setFollowUp, true);
    expect(listening.state.followUp).toBe(false);
    listening.set(true);
    await invoke(IPC.setFollowUp, true);
    expect(listening.state.followUp).toBe(true);
    await expect(invoke(IPC.setFollowUp, 'yes')).rejects.toThrow('open or closed');
  });

  it('previews a voice through the brain’s speak_sample, and gives back the audio', async () => {
    const { invoke, brain } = setup();
    brain.call.mockResolvedValue([
      { type: 'text', text: JSON.stringify({ mime: 'audio/wav', data: 'UklGRg==' }) },
    ]);
    expect(await invoke(IPC.speakSample, 'Hello', 'bm_george', 1.1)).toEqual({
      mime: 'audio/wav',
      data: 'UklGRg==',
    });
    expect(brain.call).toHaveBeenCalledWith('speak_sample', {
      text: 'Hello',
      voice: 'bm_george',
      speed: 1.1,
    });
  });

  it('gives back null when the brain has no voice to preview with', async () => {
    const { invoke, brain } = setup();
    brain.call.mockResolvedValue([{ type: 'text', text: 'Voice is not running on this brain.' }]);
    expect(await invoke(IPC.speakSample, 'Hello', 'bm_george', 1)).toBeNull();
    brain.call.mockRejectedValue(new BrainOffline());
    expect(await invoke(IPC.speakSample, 'Hello', 'bm_george', 1)).toBeNull();
  });
});

describe('the brain coming back', () => {
  it('asks to listen again if a session was open, and not after stop', async () => {
    const { invoke, brain, bridge } = setup();
    await invoke(IPC.earsListen, 'always');
    brain.listen.mockClear();
    bridge.onOnline();
    expect(brain.listen).toHaveBeenCalledWith('always');
    await invoke(IPC.earsStop);
    brain.listen.mockClear();
    bridge.onOnline();
    expect(brain.listen).not.toHaveBeenCalled();
  });
});

describe('what the brain sends back', () => {
  const heard = (bridge: ReturnType<typeof setup>['bridge'], event: string, text?: string) =>
    bridge.onNotification('heard', text === undefined ? { event } : { event, text });

  it('forwards heard events to the panel in the ears’ own words', () => {
    const { bridge, sent } = setup();
    heard(bridge, 'speech_start');
    heard(bridge, 'partial', 'what');
    heard(bridge, 'final', 'what is');
    heard(bridge, 'turn_end', 'what is this');
    expect(sent).toEqual([
      [IPC.earsEvent, { event: 'speechStart' }],
      [IPC.earsEvent, { event: 'partial', text: 'what' }],
      [IPC.earsEvent, { event: 'final', text: 'what is' }],
      [IPC.earsEvent, { event: 'turnEnd', text: 'what is this' }],
    ]);
  });

  it('forwards the voice status and progress, and shows loading and failure on Scout', () => {
    const marks = new StatusMarks();
    const { bridge, sent } = setup(undefined, { marks });
    bridge.onNotification('voice', { status: 'loading' });
    expect(marks.top()).toEqual({ id: 'ears-loading' });
    bridge.onNotification('voice', { status: 'loading', progress: 0.4 });
    expect(marks.top()).toEqual({ id: 'ears-loading', percent: 40 });
    bridge.onNotification('voice', { status: 'failed', message: 'offline' });
    expect(marks.top()).toEqual({ id: 'ears-failed' });
    bridge.onNotification('voice', { status: 'ready' });
    expect(marks.top()).toBeNull();
    expect(sent).toContainEqual([IPC.earsStatusEvent, { status: 'loading', progress: 0.4 }]);
    expect(sent).toContainEqual([IPC.earsStatusEvent, { status: 'failed', message: 'offline' }]);
    expect(sent).toContainEqual([IPC.earsStatusEvent, { status: 'ready' }]);
  });

  it('forwards speech chunks and the end of a turn’s speech to the panel', () => {
    const { bridge, sent } = setup();
    bridge.onNotification('speech', { turn: 't1', text: 'Hi.', pcm: 'AAA=', sample_rate: 24000 });
    bridge.onNotification('speech', { turn: 't1', text: 'Plain.' });
    bridge.onNotification('speech', { turn: 't1', done: true });
    expect(sent).toEqual([
      [IPC.speechChunk, { turn: 't1', text: 'Hi.', pcm: 'AAA=', sampleRate: 24000 }],
      [IPC.speechChunk, { turn: 't1', text: 'Plain.' }],
      [IPC.speechDone, { turn: 't1' }],
    ]);
  });

  it('ignores notifications that are not voice ones', () => {
    const { bridge, sent } = setup();
    bridge.onNotification('reply', { turn: 't1', delta: 'x' });
    expect(sent).toEqual([]);
  });

  it('reports the ears as fine until the brain says they failed', () => {
    const { bridge } = setup();
    expect(bridge.models()).toEqual({ mouth: true, ears: true });
    bridge.onNotification('voice', { status: 'failed' });
    expect(bridge.models()).toEqual({ mouth: true, ears: false });
    bridge.onNotification('voice', { status: 'ready' });
    expect(bridge.models()).toEqual({ mouth: true, ears: true });
  });

  it('brings the bubble up only for words addressed to Scout, never for bare speech', () => {
    const onSpoken = vi.fn();
    const { bridge } = setup(undefined, { onSpoken });
    heard(bridge, 'speech_start');
    heard(bridge, 'partial', 'what');
    heard(bridge, 'turn_end', 'what is Scout doing');
    expect(onSpoken).not.toHaveBeenCalled();
    heard(bridge, 'partial', 'Scout, what');
    expect(onSpoken).toHaveBeenCalledOnce();
  });

  it('a partial "Scout, st" might still be "stop", so the bubble stays down', () => {
    const onSpoken = vi.fn();
    const { bridge } = setup(undefined, { onSpoken });
    heard(bridge, 'partial', 'Scout, st');
    expect(onSpoken).not.toHaveBeenCalled();
    heard(bridge, 'partial', 'Scout, sta');
    expect(onSpoken).toHaveBeenCalledOnce();
  });

  it('"Scout, stop" switches listening off without bringing the bubble up', () => {
    const onSpoken = vi.fn();
    const { bridge, sent } = setup(undefined, { onSpoken });
    heard(bridge, 'partial', 'Scout, stop');
    heard(bridge, 'turn_end', 'Scout, stop listening.');
    expect(onSpoken).not.toHaveBeenCalled();
    expect(sent).toHaveLength(2);
  });

  it('in the follow-up window, any words bring the bubble up, but a plain "stop" does not', () => {
    const onSpoken = vi.fn();
    let followUp = true;
    const { bridge } = setup(undefined, { onSpoken, followUp: () => followUp });
    heard(bridge, 'turn_end', 'stop');
    expect(onSpoken).not.toHaveBeenCalled();
    heard(bridge, 'turn_end', 'and tomorrow?');
    expect(onSpoken).toHaveBeenCalledOnce();
    followUp = false;
    heard(bridge, 'turn_end', 'and tomorrow?');
    expect(onSpoken).toHaveBeenCalledOnce();
  });
});
