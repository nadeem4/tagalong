/**
 * Scout's mouth in main: picks who says a line (Kokoro or the system voice), falls through on
 * failure, and returns audio for the bubble to play, or tells the bubble to use the window's own
 * system voice. Contains createVoiceService, LazyLocalVoice, the mouths and fakeTts.
 */

import { chosenMouth, mouthOrder } from '../../shared/voice';
import type { MouthId } from '@tagalong/ui/shapes';
import type { Settings, VoiceId } from '../../shared/settings';
import type { SpeakResult } from '../../shared/ipc';

/** How a line is said: the local voice's id, and how fast. */
export interface SpeakOptions {
  voice: VoiceId;
  speed: number;
}

/** Encoded audio for one line, ready for the renderer to play. */
export interface SpokenAudio {
  audio: Uint8Array;
  mime: string;
}

/** Anything that turns a line into audio: Kokoro or the fake. */
export interface Tts {
  speak(text: string, options: SpeakOptions): Promise<SpokenAudio>;
}

/** The local voice, which needs its model downloaded before it can speak. */
export interface LocalVoice extends Tts {
  ready(): boolean;
  /** Starts loading the model, if it is not loaded or loading already. */
  warm(): void;
}

/** The slice of a loaded Kokoro model this host uses. */
export interface LocalSynth {
  generate(
    text: string,
    options: { voice: VoiceId; speed: number },
  ): Promise<{ toWav(): ArrayBuffer }>;
}

/**
 * The local voice, loaded on first use rather than at start: the model is a ~90 MB
 * download, and nobody should pay for it before Scout first speaks. A failed download is
 * tried again the next time Scout speaks.
 */
export class LazyLocalVoice implements LocalVoice {
  readonly #load: () => Promise<LocalSynth>;
  #loading: Promise<void> | null = null;
  #synth: LocalSynth | null = null;

  constructor(load: () => Promise<LocalSynth>) {
    this.#load = load;
  }

  ready(): boolean {
    return this.#synth !== null;
  }

  /** Waits for a warm-up under way, if any; true when the model is loaded. */
  async loaded(): Promise<boolean> {
    await this.#loading;
    return this.#synth !== null;
  }

  warm(): void {
    if (this.#synth !== null || this.#loading !== null) return;
    this.#loading = this.#load().then(
      (synth) => {
        this.#synth = synth;
      },
      (error: unknown) => {
        console.warn('[voice] the local voice could not load', error);
        this.#loading = null;
      },
    );
  }

  async speak(text: string, options: SpeakOptions): Promise<SpokenAudio> {
    if (this.#synth === null) throw new Error('The local voice is not loaded yet.');
    const audio = await this.#synth.generate(text, options);
    return { audio: new Uint8Array(audio.toWav()), mime: 'audio/wav' };
  }
}

/** A WAV of silence, so the fake has real audio to hand over. */
export function silentWav(milliseconds: number, sampleRate = 24_000): Uint8Array {
  const samples = Math.round((sampleRate * milliseconds) / 1000);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

/** Speaks nothing, instantly. What tests and the end-to-end suite use. */
export const fakeTts: Tts = {
  speak: async () => ({ audio: silentWav(100), mime: 'audio/wav' }),
};

/** One mouth adapter main can run. `null` from `speak`: not ready yet (a model still loading). */
interface MouthEngine {
  usable(): Promise<boolean>;
  speak(text: string, options: SpeakOptions): Promise<SpokenAudio | null>;
}

/** The registry: every mouth main can run. The system voice is the window's, not main's. */
type MouthEngines = Readonly<Record<Exclude<MouthId, 'system'>, MouthEngine>>;

/** Kokoro: always usable; while it loads, the line goes on to the next voice. */
export function localMouth(local: LocalVoice): MouthEngine {
  return {
    usable: async () => true,
    speak: async (text, how) => {
      if (!local.ready()) {
        local.warm();
        return null;
      }
      return local.speak(text, how);
    },
  };
}

interface VoiceServiceOptions {
  env: Readonly<Record<string, string | undefined>>;
  settings: () => Settings['voice'];
  /** Kokoro, for the warm-up at start. */
  local: LocalVoice;
  mouths: MouthEngines;
}

/**
 * Picks who says a line: the chosen mouth, then Kokoro, then the system voice in the
 * window, each step down quiet. `TAGALONG_FAKE_TTS=1` means the fake, always.
 */
export function createVoiceService(options: VoiceServiceOptions) {
  const { env, settings, local, mouths } = options;
  return {
    /**
     * At start: loads the local voice when an earlier run downloaded it, so Scout's first
     * lines are Kokoro rather than the system voice. Never starts a download, and never
     * loads it for someone who picked the system voice.
     */
    warmAtStart(downloaded: boolean): void {
      const chosen = settings();
      if (env.TAGALONG_FAKE_TTS === '1' || !chosen.enabled || !downloaded) return;
      if (chosenMouth(chosen) === 'system') return;
      local.warm();
    },
    /**
     * Says one line. `preview` is Settings' Preview, which plays even while Scout talks
     * is off, in the voice and speed the form shows rather than the saved ones.
     */
    async speak(
      text: string,
      preview?: Partial<SpeakOptions> & { mouth?: MouthId },
    ): Promise<SpeakResult> {
      const chosen = settings();
      if (preview === undefined && !chosen.enabled) return { kind: 'off' };
      const how: SpeakOptions = {
        voice: preview?.voice ?? chosen.voice,
        speed: preview?.speed ?? chosen.speed,
      };
      if (env.TAGALONG_FAKE_TTS === '1')
        return { kind: 'audio', ...(await fakeTts.speak(text, how)) };
      for (const id of mouthOrder(preview?.mouth ?? chosenMouth(chosen))) {
        if (id === 'system') return { kind: 'fallback', speed: how.speed };
        try {
          const mouth = mouths[id];
          if (!(await mouth.usable())) continue;
          const audio = await mouth.speak(text, how);
          if (audio !== null) return { kind: 'audio', ...audio };
        } catch (error) {
          console.warn(`[voice] ${id} failed, trying the next voice`, error);
        }
      }
      return { kind: 'fallback', speed: how.speed };
    },
  };
}

export type VoiceService = ReturnType<typeof createVoiceService>;
