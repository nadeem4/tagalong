/**
 * Scout's voice slots. Ears turn the microphone into words, a Mouth turns Scout's answer
 * into speech, and a Live voice (later) replaces both. Each vendor or model is one adapter
 * filling a slot, listed here with the plain facts Settings shows. No adapter runs here:
 * this file imports nothing, so main, the voice process and the windows all share it.
 */

/** The ears hear 16 kHz mono audio, in frames of this many samples (32 ms). */
export const EARS_SAMPLE_RATE = 16_000;
export const EARS_FRAME = 512;

/** The microphone, as the ears take it: one frame after another until it closes. */
export type MicStream = AsyncIterable<Float32Array>;

export type EarsEvent = 'speechStart' | 'partial' | 'final' | 'turnEnd';

/**
 * `held`: the talk key or the mic button; the turn ends when listening stops. `always`:
 * Always listening; the end-of-turn model decides when the person has finished.
 */
export type ListenMode = 'held' | 'always';

/** Microphone to words; says when you start talking (so Scout stops) and when you have finished. */
export interface Ears {
  listen(mic: MicStream): void;
  stop(): void;
  on(event: EarsEvent, handler: (text?: string) => void): void;
}

/** Scout's answer to speech, streamed sentence by sentence, stoppable at once. */
export interface Mouth {
  speak(text: AsyncIterable<string>): void;
  stop(): void;
}

/** What a Live provider asks of Scout: one turn, the same one typing and talking use. */
export interface ScoutTurn {
  ask(text: string): AsyncIterable<string>;
}

export interface LiveSession {
  close(): void;
}

/** One hosted real-time service replacing Ears and Mouth. A slot only: none is built yet. */
export interface LiveVoice {
  connect(scout: ScoutTurn): LiveSession;
}

export type VoiceSetup = { ears: Ears; mouth: Mouth } | { live: LiveVoice };

export const EARS_IDS = ['sherpa'] as const;
export type EarsId = (typeof EARS_IDS)[number];

export const MOUTH_IDS = ['kokoro', 'elevenlabs', 'system'] as const;
export type MouthId = (typeof MOUTH_IDS)[number];

/** The voice on this computer: what the chosen one falls back to before the system voice. */
export const LOCAL_MOUTH: MouthId = 'kokoro';

/** What a person needs to know before picking an adapter. */
export interface VoiceAdapterFacts {
  id: string;
  slot: 'ears' | 'mouth' | 'live';
  label: string;
  offline: boolean;
  needsKey: boolean;
  costs: boolean;
  screenshots: boolean;
}

export const VOICE_ADAPTERS: readonly VoiceAdapterFacts[] = [
  {
    id: 'sherpa',
    slot: 'ears',
    label: 'On this computer',
    offline: true,
    needsKey: false,
    costs: false,
    screenshots: false,
  },
  {
    id: 'kokoro',
    slot: 'mouth',
    label: 'Kokoro, on this computer',
    offline: true,
    needsKey: false,
    costs: false,
    screenshots: false,
  },
  {
    id: 'elevenlabs',
    slot: 'mouth',
    label: 'ElevenLabs, with your key',
    offline: false,
    needsKey: true,
    costs: true,
    screenshots: false,
  },
  {
    id: 'system',
    slot: 'mouth',
    label: 'The system voice',
    offline: true,
    needsKey: false,
    costs: false,
    screenshots: false,
  },
];

export function adaptersFor(slot: VoiceAdapterFacts['slot']): readonly VoiceAdapterFacts[] {
  return VOICE_ADAPTERS.filter((adapter) => adapter.slot === slot);
}

/** The chosen voice, then the local one, then the system voice, each once. */
export function mouthOrder(chosen: MouthId): MouthId[] {
  return [...new Set<MouthId>([chosen, LOCAL_MOUTH, 'system'])];
}

/**
 * The mouth the person picked. A settings file from before the picker has no `mouth`: one
 * with an ElevenLabs voice set was speaking with ElevenLabs, and keeps doing so.
 */
export function chosenMouth(voice: { mouth?: MouthId | undefined; elevenLabsVoiceId: string }): MouthId {
  return voice.mouth ?? (voice.elevenLabsVoiceId !== '' ? 'elevenlabs' : LOCAL_MOUTH);
}

/**
 * An async stream fed by pushes, for one reader: frames from the microphone, sentences of
 * a spoken answer. Past `limit` waiting items the oldest is dropped. Pushes after `end`
 * are ignored; items already waiting are still read.
 */
export class Pushable<T> implements AsyncIterable<T> {
  readonly #items: T[] = [];
  readonly #limit: number;
  #waiting: ((result: IteratorResult<T>) => void) | null = null;
  #ended = false;

  constructor(limit = Number.POSITIVE_INFINITY) {
    this.#limit = limit;
  }

  push(item: T): void {
    if (this.#ended) return;
    const waiting = this.#waiting;
    if (waiting !== null) {
      this.#waiting = null;
      waiting({ value: item, done: false });
      return;
    }
    this.#items.push(item);
    if (this.#items.length > this.#limit) this.#items.shift();
  }

  end(): void {
    this.#ended = true;
    const waiting = this.#waiting;
    this.#waiting = null;
    waiting?.({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.#items.length > 0) {
          return Promise.resolve({ value: this.#items.shift() as T, done: false });
        }
        if (this.#ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<T>>((resolve) => {
          this.#waiting = resolve;
        });
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
