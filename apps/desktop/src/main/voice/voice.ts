import type { Settings, VoiceId } from '@tagalong/protocol';
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

/** Anything that turns a line into audio: Kokoro, ElevenLabs, or the fake. */
export interface Tts {
  speak(text: string, options: SpeakOptions): Promise<SpokenAudio>;
}

/** The local voice, which needs its model downloaded before it can speak. */
export interface LocalVoice extends Tts {
  ready(): boolean;
  /** Starts loading the model, if it is not loaded or loading already. */
  warm(): void;
}

export type { SpeakResult };

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

export interface VoiceServiceOptions {
  env: Readonly<Record<string, string | undefined>>;
  settings: () => Settings['voice'];
  elevenLabsKey: () => Promise<string | null>;
  local: LocalVoice;
  elevenLabs: (apiKey: string, voiceId: string) => Tts;
}

/**
 * Picks who says a line. `TAGALONG_FAKE_TTS=1` means the fake, always: no download, no
 * service, no sound. Otherwise ElevenLabs when the person gave a key and picked a voice,
 * then the local Kokoro voice, then the system voice in the renderer while Kokoro
 * downloads or if it fails. Each step down is quiet: the line is still said.
 */
export function createVoiceService(options: VoiceServiceOptions) {
  const { env, settings, elevenLabsKey, local, elevenLabs } = options;
  return {
    /**
     * At start: loads the local voice when an earlier run downloaded it, so Scout's first
     * lines are Kokoro rather than the system voice. Never starts a download.
     */
    warmAtStart(downloaded: boolean): void {
      if (env.TAGALONG_FAKE_TTS === '1' || !settings().enabled || !downloaded) return;
      local.warm();
    },
    /**
     * Says one line. `preview` is Settings' ▶ Preview, which plays even while Scout talks
     * is off, in the voice and speed the form shows rather than the saved ones.
     */
    async speak(text: string, preview?: Partial<SpeakOptions>): Promise<SpeakResult> {
      const chosen = settings();
      if (preview === undefined && !chosen.enabled) return { kind: 'off' };
      const how: SpeakOptions = {
        voice: preview?.voice ?? chosen.voice,
        speed: preview?.speed ?? chosen.speed,
      };
      if (env.TAGALONG_FAKE_TTS === '1')
        return { kind: 'audio', ...(await fakeTts.speak(text, how)) };

      const key = await elevenLabsKey();
      if (key !== null && key !== '' && chosen.elevenLabsVoiceId !== '') {
        try {
          return {
            kind: 'audio',
            ...(await elevenLabs(key, chosen.elevenLabsVoiceId).speak(text, how)),
          };
        } catch (error) {
          console.warn('[voice] ElevenLabs failed, using the local voice', error);
        }
      }

      if (!local.ready()) {
        local.warm();
        return { kind: 'fallback' };
      }
      try {
        return { kind: 'audio', ...(await local.speak(text, how)) };
      } catch (error) {
        console.warn('[voice] the local voice failed, using the system voice', error);
        return { kind: 'fallback' };
      }
    },
  };
}

export type VoiceService = ReturnType<typeof createVoiceService>;
