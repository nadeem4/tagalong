import type { TranscribeResult } from '../../shared/ipc';

export type { TranscribeResult };

/** What the fake hears, whatever was said. The end-to-end suite asks this question. */
export const FAKE_TRANSCRIPT = 'What am I looking at?';

/** Whisper listens at 16 kHz, mono: the renderer resamples the microphone to this. */
export const SAMPLE_RATE = 16_000;

/** Shorter than this is a click of the key, not a word. */
const MIN_SECONDS = 0.3;

/** Quieter than this, all the way through, is a room with nobody talking. */
const SILENCE_PEAK = 0.01;

/** Anything that turns 16 kHz mono samples into words. */
export interface Stt {
  transcribe(samples: Float32Array): Promise<string>;
}

/** The on-device model, which downloads before its first use. */
export interface LocalStt extends Stt {
  ready(): boolean;
  /** Starts loading the model, if it is not loaded or loading already. */
  warm(): void;
}

/** A loaded recogniser: samples in, words out. */
export type Recognizer = (samples: Float32Array) => Promise<string>;

/**
 * The local speech-to-text model, loaded when Talk to Scout is first used rather than at
 * start: the model is a download of about 80 MB. Unlike the voice there is no system
 * fallback, so a question waits for the model. A failed load is tried again next time.
 */
export class LazyLocalStt implements LocalStt {
  readonly #load: () => Promise<Recognizer>;
  #loading: Promise<Recognizer> | null = null;
  #recognizer: Recognizer | null = null;

  constructor(load: () => Promise<Recognizer>) {
    this.#load = load;
  }

  ready(): boolean {
    return this.#recognizer !== null;
  }

  warm(): void {
    this.#ensure().catch((error: unknown) =>
      console.warn('[listen] the speech model could not load', error),
    );
  }

  async transcribe(samples: Float32Array): Promise<string> {
    const recognizer = await this.#ensure();
    return recognizer(samples);
  }

  #ensure(): Promise<Recognizer> {
    if (this.#recognizer !== null) return Promise.resolve(this.#recognizer);
    this.#loading ??= this.#load().then(
      (recognizer) => {
        this.#recognizer = recognizer;
        return recognizer;
      },
      (error: unknown) => {
        this.#loading = null;
        throw error;
      },
    );
    return this.#loading;
  }
}

/** Drops the markers Whisper writes for silence and noise: [BLANK_AUDIO], (music). */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nothingSaid(samples: Float32Array): boolean {
  if (samples.length < SAMPLE_RATE * MIN_SECONDS) return true;
  for (const sample of samples) if (Math.abs(sample) > SILENCE_PEAK) return false;
  return true;
}

export interface ListenServiceOptions {
  env: Readonly<Record<string, string | undefined>>;
  local: LocalStt;
}

/**
 * Talk to Scout's ears. `TAGALONG_FAKE_STT=1` hears FAKE_TRANSCRIPT every time: no
 * download, no model, and no real microphone needed. Otherwise the local model, on this
 * computer: the audio is never sent anywhere and never stored.
 */
export function createListenService({ env, local }: ListenServiceOptions) {
  const fake = env.TAGALONG_FAKE_STT === '1';
  return {
    /** Listening started: load the model while the person talks. */
    prepare(): { ready: boolean } {
      if (fake) return { ready: true };
      if (!local.ready()) local.warm();
      return { ready: local.ready() };
    },

    async transcribe(samples: Float32Array): Promise<TranscribeResult> {
      if (fake) return { kind: 'text', text: FAKE_TRANSCRIPT };
      if (nothingSaid(samples)) return { kind: 'text', text: '' };
      try {
        return { kind: 'text', text: cleanTranscript(await local.transcribe(samples)) };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn('[listen] transcription failed', error);
        return { kind: 'failed', message: `Speech could not be turned into text: ${reason}` };
      }
    },
  };
}

export type ListenService = ReturnType<typeof createListenService>;
