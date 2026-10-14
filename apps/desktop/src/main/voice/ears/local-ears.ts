import { EARS_SAMPLE_RATE } from '@tagalong/protocol';
import type { Ears, EarsEvent, ListenMode, MicStream } from '@tagalong/protocol';

/** Speech or not, frame by frame (Silero). */
export interface Vad {
  accept(frame: Float32Array): Promise<boolean>;
}

/** Words so far for the current stretch of speech (Moonshine, or a streaming Zipformer). */
export interface StreamingStt {
  accept(frame: Float32Array): void;
  text(): Promise<string>;
  reset(): void;
}

/** How sure the person has finished, 0 to 1 (Smart Turn), from the turn's last 8 s. */
export interface EndOfTurn {
  complete(samples: Float32Array): Promise<number>;
}

export interface EarsParts {
  vad: Vad;
  stt: StreamingStt;
  turn: EndOfTurn;
}

/** 256 ms of quiet ends a stretch of speech and asks the end-of-turn model. */
export const PAUSE_FRAMES = 8;
/** About 2 s more of quiet ends the turn whatever the model says. */
export const GIVE_UP_FRAMES = 63;
/** Live words about three times a second. */
export const PARTIAL_EVERY_FRAMES = 10;
export const TURN_THRESHOLD = 0.5;
/** Speech that never goes quiet (noise) is closed as a stretch after about 30 s. */
export const MAX_STRETCH_FRAMES = 938;
/** Smart Turn reads the last 8 s. */
const TURN_SAMPLES = 8 * EARS_SAMPLE_RATE;

/**
 * The local ears. Silence is ignored; the first speech starts a turn ("speechStart", so
 * Scout stops talking); words show as they come ("partial"); each pause closes a stretch
 * ("final"). Held: the turn ends when listening stops, even with nothing said. Always: it
 * ends when the end-of-turn model is sure, or after a long silence. Nothing is kept once
 * the turn is handed over; nothing at all after `stop`.
 */
export class LocalEars implements Ears {
  readonly #parts: EarsParts;
  readonly #mode: ListenMode;
  readonly #handlers = new Map<EarsEvent, Set<(text?: string) => void>>();
  #run = 0;
  #inTurn = false;
  #inSpeech = false;
  #quiet = 0;
  #sincePartial = 0;
  #lastPartial = '';
  #heard: string[] = [];
  #audio: Float32Array[] = [];
  #stretch = 0;
  #closing: Promise<void> | undefined;

  constructor(parts: EarsParts, mode: ListenMode) {
    this.#parts = parts;
    this.#mode = mode;
  }

  on(event: EarsEvent, handler: (text?: string) => void): void {
    const set = this.#handlers.get(event) ?? new Set();
    set.add(handler);
    this.#handlers.set(event, set);
  }

  listen(mic: MicStream): void {
    const run = ++this.#run;
    this.#reset();
    void (async () => {
      for await (const frame of mic) {
        if (run !== this.#run) return;
        await this.#frame(frame, run);
      }
    })().catch((error: unknown) => console.warn('[ears] listening stopped', error));
  }

  stop(): void {
    const run = ++this.#run;
    if (this.#mode === 'always') {
      this.#reset();
      return;
    }
    void (async () => {
      try {
        await this.#closing;
        if (this.#inSpeech) await this.#closeStretch(run, true);
      } catch (error) {
        console.warn('[ears] the speech model failed; ending the turn with what was heard', error);
      } finally {
        this.#endTurn(true);
      }
    })();
  }

  async #frame(frame: Float32Array, run: number): Promise<void> {
    const speech = await this.#parts.vad.accept(frame);
    if (run !== this.#run) return;
    if (!this.#inTurn && !speech) return;
    if (speech) {
      if (!this.#inTurn) {
        this.#inTurn = true;
        this.#emit('speechStart');
      }
      this.#inSpeech = true;
      this.#quiet = 0;
      this.#keep(frame);
      this.#parts.stt.accept(frame);
      this.#stretch += 1;
      if (this.#stretch >= MAX_STRETCH_FRAMES) {
        await this.#close(run);
        return;
      }
      this.#sincePartial += 1;
      if (this.#sincePartial >= PARTIAL_EVERY_FRAMES) {
        this.#sincePartial = 0;
        const words = await this.#parts.stt.text();
        if (run !== this.#run) return;
        const partial = [...this.#heard, words].join(' ').trim();
        if (partial !== '' && partial !== this.#lastPartial) {
          this.#lastPartial = partial;
          this.#emit('partial', partial);
        }
      }
      return;
    }
    this.#quiet += 1;
    if (this.#inSpeech) {
      this.#keep(frame);
      this.#parts.stt.accept(frame);
      if (this.#quiet === PAUSE_FRAMES) await this.#close(run);
      return;
    }
    if (this.#mode === 'always' && this.#quiet >= PAUSE_FRAMES + GIVE_UP_FRAMES)
      this.#endTurn(false);
  }

  /** Close a stretch from the frame loop; `stop` waits on `#closing`, which never rejects. */
  #close(run: number): Promise<void> {
    const closing = this.#closeStretch(run, false);
    this.#closing = closing.catch(() => undefined);
    return closing;
  }

  async #closeStretch(run: number, stopping: boolean): Promise<void> {
    this.#inSpeech = false;
    this.#stretch = 0;
    const words = (await this.#parts.stt.text()).trim();
    // After a stop, always mode drops the turn; held mode still hands over the last words.
    if (run !== this.#run && this.#mode === 'always') return;
    this.#parts.stt.reset();
    if (words !== '') {
      this.#heard.push(words);
      this.#emit('final', words);
    }
    if (this.#mode !== 'always' || stopping) return;
    let score = 1;
    try {
      score = await this.#parts.turn.complete(this.#lastSeconds());
    } catch (error) {
      console.warn('[ears] the end-of-turn model failed; taking the turn as over', error);
    }
    if (run !== this.#run) return;
    if (score >= TURN_THRESHOLD) this.#endTurn(false);
  }

  #endTurn(held: boolean): void {
    const text = this.#heard.join(' ').trim();
    this.#reset();
    if (text !== '' || held) this.#emit('turnEnd', text);
  }

  #reset(): void {
    this.#inTurn = false;
    this.#inSpeech = false;
    this.#quiet = 0;
    this.#sincePartial = 0;
    this.#stretch = 0;
    this.#closing = undefined;
    this.#lastPartial = '';
    this.#heard = [];
    this.#audio = [];
    this.#parts.stt.reset();
  }

  #keep(frame: Float32Array): void {
    this.#audio.push(frame);
    let total = this.#audio.reduce((sum, f) => sum + f.length, 0);
    while (total > TURN_SAMPLES && this.#audio.length > 1) total -= this.#audio.shift()!.length;
  }

  #lastSeconds(): Float32Array {
    const out = new Float32Array(this.#audio.reduce((sum, f) => sum + f.length, 0));
    let at = 0;
    for (const f of this.#audio) {
      out.set(f, at);
      at += f.length;
    }
    return out;
  }

  #emit(event: EarsEvent, text?: string): void {
    for (const handler of this.#handlers.get(event) ?? []) handler(text);
  }
}
