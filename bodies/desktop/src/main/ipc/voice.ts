/**
 * IPC for Scout's voice, which lives in the brain: the mic's frames on their way to it, Always
 * listening, and what it sends back (heard words, voice status, spoken sentences). Contains
 * createVoiceBridge and registerVoiceIpc.
 */

import { BrainOffline } from '@tagalong/contract';
import type { BrainClient } from '@tagalong/contract';
import { addressedToScout, isStopListening, mightBeStop, STATUS_WORDS } from '@tagalong/ui/shapes';
import { IPC } from '../../shared/ipc';
import type { SpeakSample, VoiceModels } from '../../shared/ipc';
import type { AlwaysListening } from '../always-listening';
import type { StatusMarks } from '../status-marks';
import { callJson } from '../brain/call-json';
import type { IpcHandle, IpcOn } from './handle';

type VoiceBrain = Pick<BrainClient, 'listen' | 'mic' | 'unlisten' | 'hush'>;

const HEARD_EVENTS = {
  speech_start: 'speechStart',
  partial: 'partial',
  final: 'final',
  turn_end: 'turnEnd',
} as const;

interface BridgeDeps {
  brain: VoiceBrain;
  /** Sends to every open window. */
  send: (channel: string, payload: unknown) => void;
  /** Words addressed to Scout were heard: the bubble may come up. */
  onSpoken?: () => void;
  /** The follow-up window is open: a reply needs no name. */
  followUp?: () => boolean;
  /** The speech models loading, or the voice failing: shown on Scout. */
  marks?: Pick<StatusMarks, 'set' | 'clear'>;
}

export interface VoiceBridge {
  listen(mode: 'held' | 'always'): Promise<void>;
  frame(samples: Float32Array): void;
  stop(): void;
  /** The brain is reachable again: an open listening session asks the new connection to listen. */
  onOnline(): void;
  /** Heard, voice and speech notifications from the brain; any other method is ignored. */
  onNotification(method: string, params: unknown): void;
  /** The health check: the brain's last word on its voice. */
  models(): VoiceModels;
}

/** Float32 samples (-1..1) as 16-bit, clamped. */
function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    out[i] = Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767);
  }
  return out;
}

export function createVoiceBridge(deps: BridgeDeps): VoiceBridge {
  const { brain, send, marks } = deps;
  /** The open listening session, if any, so a reconnect can ask again. */
  let mode: 'held' | 'always' | null = null;
  let voiceFailed = false;

  const failed = (message: string): void => {
    send(IPC.earsStatusEvent, { status: 'failed', message });
  };

  const request = async (wanted: 'held' | 'always'): Promise<void> => {
    try {
      await brain.listen(wanted);
    } catch (error) {
      mode = null;
      failed(
        error instanceof BrainOffline
          ? STATUS_WORDS['brain-offline'].detail
          : 'Listening could not start. Try again.',
      );
    }
  };

  const heard = (params: { event: keyof typeof HEARD_EVENTS; text?: string }): void => {
    const event = HEARD_EVENTS[params.event];
    const { text } = params;
    const question =
      (event === 'partial' || event === 'turnEnd') && text !== undefined
        ? addressedToScout(text, { followUp: deps.followUp?.() === true })
        : null;
    // A partial "Scout, st" may still become "stop": not a question until it cannot.
    const stop =
      question !== null &&
      (event === 'partial' ? mightBeStop(question) : isStopListening(question));
    if (question !== null && !stop) deps.onSpoken?.();
    send(IPC.earsEvent, text === undefined ? { event } : { event, text });
  };

  const voice = (params: {
    status: 'loading' | 'ready' | 'failed';
    message?: string;
    progress?: number;
  }): void => {
    voiceFailed = params.status === 'failed';
    if (params.status === 'failed') {
      marks?.clear('ears-loading');
      marks?.set({ id: 'ears-failed' });
    } else if (params.status === 'ready') {
      marks?.clear('ears-loading');
      marks?.clear('ears-failed');
    } else if (params.progress !== undefined) {
      marks?.set({ id: 'ears-loading', percent: Math.round(params.progress * 100) });
    } else {
      marks?.set({ id: 'ears-loading' });
    }
    send(IPC.earsStatusEvent, {
      status: params.status,
      ...(params.message === undefined ? {} : { message: params.message }),
      ...(params.progress === undefined ? {} : { progress: params.progress }),
    });
  };

  return {
    listen: async (wanted) => {
      mode = wanted;
      await request(wanted);
    },
    frame: (samples) => void brain.mic(toInt16(samples)),
    stop: () => {
      mode = null;
      brain.unlisten();
    },
    onOnline: () => {
      if (mode !== null) void request(mode);
    },
    onNotification: (method, params) => {
      if (method === 'heard') heard(params as Parameters<typeof heard>[0]);
      else if (method === 'voice') voice(params as Parameters<typeof voice>[0]);
      else if (method === 'speech') {
        const p = params as {
          turn: string;
          text?: string;
          pcm?: string;
          sample_rate?: number;
          done?: true;
        };
        if (p.done === true) send(IPC.speechDone, { turn: p.turn });
        else {
          send(IPC.speechChunk, {
            turn: p.turn,
            ...(p.text === undefined ? {} : { text: p.text }),
            ...(p.pcm === undefined ? {} : { pcm: p.pcm }),
            ...(p.sample_rate === undefined ? {} : { sampleRate: p.sample_rate }),
          });
        }
      }
    },
    // The brain's `voice` frames come from the ears alone; the mouth has no status to show.
    models: () => ({ mouth: true, ears: !voiceFailed }),
  };
}

interface VoiceIpcDeps {
  bridge: VoiceBridge;
  brain: VoiceBrain & Pick<BrainClient, 'call'>;
  /** Notes the window you are on, as the ask key does. */
  noteActiveWindow: () => Promise<unknown>;
  /** Always listening: only the person switches it, from the bubble. */
  listening: () => Pick<AlwaysListening, 'state' | 'set' | 'setFollowUp'>;
  on: IpcOn;
}

export function registerVoiceIpc(handle: IpcHandle, deps: VoiceIpcDeps): void {
  const { bridge } = deps;
  // Frames and stop wait for a listen still noting the window, so the brain hears them in
  // the order the panel sent them. A failed step does not hold up the next.
  let queue: Promise<void> = Promise.resolve();
  const inOrder = (step: () => void | Promise<void>): Promise<void> => {
    const next = queue.then(step);
    queue = next.catch(() => undefined);
    return next;
  };

  // A held question notes the window you are on, as the ask key does (never the selection:
  // copying it would press keys while the talk key is held).
  handle(IPC.earsListen, (_event, mode: string) => {
    if (mode !== 'held' && mode !== 'always') {
      throw new Error(`Unknown listening mode: ${String(mode)}`);
    }
    const noted =
      mode === 'held'
        ? deps
            .noteActiveWindow()
            .then(() => undefined)
            .catch((error: unknown) =>
              console.warn('[main] could not note the window for a spoken question', error),
            )
        : Promise.resolve();
    return inOrder(async () => {
      await noted;
      await bridge.listen(mode);
    });
  });

  // 16 kHz samples, a frame at a time. Handed to the brain and never kept here.
  deps.on(IPC.micFrame, (_event, samples: Float32Array) => {
    const frame = samples instanceof Float32Array ? samples : new Float32Array(samples);
    inOrder(() => bridge.frame(frame)).catch((error: unknown) =>
      console.warn('[main] a mic frame could not reach the brain', error),
    );
  });

  handle(IPC.earsStop, () => inOrder(() => bridge.stop()));
  handle(IPC.hush, () => deps.brain.hush());

  handle(IPC.getListening, () => deps.listening().state);
  handle(IPC.setListening, (_event, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('Always listening is on or off.');
    return deps.listening().set(on);
  });
  // The panel's follow-up window after Scout answered aloud: main raises the bubble for the reply.
  handle(IPC.setFollowUp, (_event, open: unknown) => {
    if (typeof open !== 'boolean') throw new Error('The follow-up window is open or closed.');
    deps.listening().setFollowUp(open);
  });

  // Settings' Preview: the brain speaks one line and sends the audio back. Anything but audio
  // (no voice running, brain offline) is null, and the form falls back to the system voice.
  handle(
    IPC.speakSample,
    async (_event, text: string, voice: string, speed: number): Promise<SpeakSample | null> => {
      try {
        const sample = (await callJson(deps.brain, 'speak_sample', {
          text: String(text),
          voice,
          speed,
        })) as Partial<SpeakSample>;
        return typeof sample.mime === 'string' && typeof sample.data === 'string'
          ? { mime: sample.mime, data: sample.data }
          : null;
      } catch {
        return null;
      }
    },
  );

  handle(IPC.voiceModels, (): VoiceModels => bridge.models());
}
