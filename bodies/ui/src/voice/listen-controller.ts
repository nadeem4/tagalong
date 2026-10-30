/**
 * When the microphone is open and what happens to what it hears: hold-to-talk, always
 * listening with "Scout" and "stop", pauses, and retry after the ears fail. Contains
 * ListenController and ListenMic. Used by the desktop renderer's talk wiring.
 */

import { FOLLOW_UP_MS, addressedToScout, isStopListening, mightBeStop } from '../shapes';
import type { Ears, ListenMode, MicStream } from '../shapes';

/** The open microphone, as the controller needs it: its frames, and a way to close it. */
export type ListenMic = MicStream & { close(): void };

export interface ListenControllerOptions {
  ears(mode: ListenMode): Ears;
  openMic(): Promise<ListenMic>;
  /** Speech started: Scout stops talking. */
  onSpeechStart(): void;
  /** The words heard so far, and the session's mode: held words are shown as said. */
  onPartial(text: string, mode: ListenMode): void;
  onHeard(text: string): void;
  onNothingHeard(): void;
  onMicFailed(error: unknown): void;
  /** The mic has actually opened and the ears are listening, not just asked to. */
  onMicOpen?(mode: ListenMode): void;
  /** "Scout, stop" was heard while listening all the time. */
  onStopListening(): void;
  /**
   * A turn that had stopped Scout ended with nothing to send, or its session ended mid-turn
   * (a call, the switch, the system voice, the talk key).
   */
  onDropped(): void;
  /**
   * Listening all the time, a turn of three words or more did not start with the name (and
   * no follow-up window was open). Never given its words.
   */
  onUnaddressed?(): void;
  /** The follow-up window opened (true) or closed (false). */
  onFollowUp?(open: boolean): void;
  /**
   * Always listening: false hands over every turn whole, no "Scout" needed and "stop" is
   * just words. Default true.
   */
  needsName?: boolean;
  /**
   * The first wait before always listening retries after the ears failed; it doubles, up to
   * five minutes. Default 30 s.
   */
  retryMs?: number;
  /** Runs `run` after `ms`; returns a cancel. Default setTimeout. */
  setTimer?(run: () => void, ms: number): () => void;
}

const RETRY_MS = 30_000;

const words = (text: string): number => text.trim().split(/\s+/u).filter(Boolean).length;
const MAX_RETRY_MS = 5 * 60_000;

const setTimer = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

interface Session {
  mode: ListenMode;
  ears: Ears;
  mic: Promise<ListenMic | null>;
  opened: boolean;
  /** Still wants the ears' events; false once handed over or dropped. */
  live: boolean;
  /**
   * Held: the key was let go. Every window hears the one stream of the ears' events, and the
   * voice process runs sessions one after another, so a turnEnd can belong to the session
   * before this one: a held session takes a turnEnd only once it has been released.
   */
  released: boolean;
  /** Always: this turn was addressed to Scout and has already cut it off. */
  barged: boolean;
}

/**
 * When the microphone is open, and what happens to what it hears. The mic opens on `hold`
 * (the talk key, the mic button) and closes on `release` or `cancel`; with Always listening
 * on (`setAlways`) it stays open, except during a call or full screen, or with the pets hidden
 * (`setPaused`), and while the system voice speaks (`setDeaf`). The talk key still asks
 * without the name then: the always session ends for the held question and comes back after
 * it. Nothing heard after a session ends reaches the bubble. Setup listens all the time
 * without the name (`needsName: false`): every turn is an answer.
 */
export class ListenController {
  readonly #options: ListenControllerOptions;
  #session: Session | null = null;
  /** Released held questions still waiting for their words; cancel drops them too. */
  readonly #released = new Set<Session>();
  /**
   * Every released session hears each turnEnd (one IPC event reaches all their handlers in
   * one go): set once one has taken it, until that event is done, so it is taken once.
   */
  #taken = false;
  #always = false;
  #paused = false;
  #deaf = false;
  /** The wait before the next retry after the ears failed, and the cancel of one pending. */
  #retryMs: number;
  #cancelRetry: (() => void) | null = null;
  /** The follow-up window's cancel while it is open: one reply needs no name. */
  #followUp: (() => void) | null = null;

  constructor(options: ListenControllerOptions) {
    this.#options = options;
    this.#retryMs = options.retryMs ?? RETRY_MS;
  }

  get mode(): ListenMode | null {
    return this.#session?.mode ?? null;
  }

  /** The talk key or the mic button: a question that needs no name, even while always listening. */
  hold(): void {
    this.closeFollowUp();
    if (this.#session?.mode === 'held') return;
    // The voice process runs sessions in order: the always session stops before this one listens.
    this.#end();
    this.#start('held');
  }

  release(): void {
    const session = this.#session;
    if (session?.mode !== 'held') return;
    this.#session = null;
    void session.mic.then((mic) => mic?.close());
    if (!session.opened) {
      session.live = false;
      this.#options.onNothingHeard();
    } else {
      session.released = true;
      this.#released.add(session);
      session.ears.stop();
    }
    this.#sync();
  }

  /**
   * Drops the question being asked, and any released question whose words have not come
   * (the bubble closed, a voice process that died): none of them is heard later. Always
   * listening is not a question: it goes on (or comes back after the held one).
   */
  cancel(): void {
    this.closeFollowUp();
    this.#dropReleased();
    if (this.#session?.mode === 'held') this.#end();
    this.#sync();
  }

  /**
   * The ears failed (the first download offline, models that would not start): every
   * question is dropped and the mic closes. Always listening stays switched on but does not
   * retry at once, which would fail again: it retries on its own after a wait (30 s, then
   * doubling up to five minutes), or sooner on the next switch, call or system voice (the
   * voice process tries its download again). Returns what was listening.
   */
  earsFailed(): ListenMode | null {
    const mode = this.mode;
    this.closeFollowUp();
    this.#dropReleased();
    this.#end();
    if (mode === 'always') this.#scheduleRetry();
    return mode;
  }

  /** Always listening, as the person switched it. Off cancels a pending retry. */
  setAlways(on: boolean): void {
    this.#always = on;
    if (!on) {
      this.#resetRetry();
      this.closeFollowUp();
    }
    this.#sync();
  }

  #scheduleRetry(): void {
    this.#cancelRetry?.();
    const wait = this.#retryMs;
    this.#retryMs = Math.min(wait * 2, MAX_RETRY_MS);
    this.#cancelRetry = (this.#options.setTimer ?? setTimer)(() => {
      this.#cancelRetry = null;
      this.#sync();
    }, wait);
  }

  /** A question heard, or the switch off: the next failure waits the first wait again. */
  #resetRetry(): void {
    this.#cancelRetry?.();
    this.#cancelRetry = null;
    this.#retryMs = this.#options.retryMs ?? RETRY_MS;
  }

  /** A call or a full-screen window, or the pets hidden: the mic closes until it is over. */
  setPaused(paused: boolean): void {
    this.#paused = paused;
    if (paused) this.closeFollowUp();
    this.#sync();
  }

  /**
   * Scout has just finished an answer aloud: for the next 20 s one reply needs no name, so a
   * back-and-forth flows. Only while Always listening is on and not paused. Closed by the
   * reply itself, the time running out, a pause, the talk key, cancel or switching off.
   */
  openFollowUp(): void {
    if (!this.#always || this.#paused) return;
    const wasOpen = this.#followUp !== null;
    this.#followUp?.();
    this.#followUp = (this.#options.setTimer ?? setTimer)(() => this.closeFollowUp(), FOLLOW_UP_MS);
    if (!wasOpen) this.#options.onFollowUp?.(true);
  }

  closeFollowUp(): void {
    if (this.#followUp === null) return;
    this.#followUp();
    this.#followUp = null;
    this.#options.onFollowUp?.(false);
  }

  /** The system voice is not echo-cancelled: while it speaks, nothing heard counts. */
  setDeaf(deaf: boolean): void {
    this.#deaf = deaf;
    this.#sync();
  }

  /**
   * Opens or closes the always session to match. A held session is left alone (the key wins);
   * stopping always listening keeps released questions waiting for their words.
   */
  #sync(): void {
    const wanted = this.#always && !this.#paused && !this.#deaf;
    const session = this.#session;
    if (wanted && session === null) this.#start('always');
    else if (!wanted && session?.mode === 'always') this.#end();
  }

  #dropReleased(): void {
    for (const waiting of this.#released) waiting.live = false;
    this.#released.clear();
  }

  /**
   * Ends the current session at once: the mic closes and nothing it hears counts. A turn that
   * had already cut Scout off lets the bubble go, as its words will never be asked.
   */
  #end(): void {
    const session = this.#session;
    if (session === null) return;
    this.#session = null;
    session.live = false;
    void session.mic.then((mic) => mic?.close());
    // A mic that never opened never listened: a stop now could end another session.
    if (session.opened) session.ears.stop();
    if (session.barged) {
      session.barged = false;
      this.#options.onDropped();
    }
  }

  /**
   * Always: words heard while a released question still waits are that question's, as the
   * voice process runs sessions in order; only talk addressed to Scout counts, and it cuts
   * Scout off once per turn. A partial that may still become "stop" ("Scout, st") is not
   * addressed yet: it neither cuts Scout off nor shows.
   */
  #addressed(session: Session, text: string, partial = false): string | null {
    if (this.#taken || this.#released.size > 0) return null;
    const question =
      this.#options.needsName === false
        ? text.trim() || null
        : addressedToScout(text, { followUp: this.#followUp !== null });
    if (partial && this.#options.needsName !== false && question !== null && mightBeStop(question))
      return null;
    if (question !== null && !session.barged) {
      session.barged = true;
      this.#options.onSpeechStart();
    }
    return question;
  }

  #start(mode: ListenMode): void {
    const ears = this.#options.ears(mode);
    const session: Session = {
      mode,
      ears,
      mic: Promise.resolve(null),
      opened: false,
      live: true,
      released: false,
      barged: false,
    };
    ears.on('speechStart', () => {
      // Always: talk in the room must not cut Scout off; only its name does.
      if (session.live && mode === 'held') this.#options.onSpeechStart();
    });
    ears.on('partial', (text) => {
      if (!session.live || text === undefined || text === '') return;
      if (mode === 'always' && this.#addressed(session, text, true) === null) return;
      this.#options.onPartial(text, mode);
    });
    ears.on('turnEnd', (text = '') => {
      if (!session.live) return;
      if (mode === 'always') {
        const barged = session.barged;
        const question = this.#addressed(session, text);
        session.barged = false;
        const named = this.#options.needsName !== false && addressedToScout(text) !== null;
        const followUp = this.#followUp !== null;
        // One reply is all the window takes, whatever it was.
        if (question !== null) this.closeFollowUp();
        if (question === null) {
          // The final words dropped the name (or came back empty): the bubble lets go.
          if (barged) this.#options.onDropped();
          if (!followUp && this.#released.size === 0 && words(text) >= 3)
            this.#options.onUnaddressed?.();
          return;
        }
        if (this.#options.needsName !== false && isStopListening(question)) {
          // A plain "stop" in the window only ends the window; "Scout, stop" switches off.
          if (named) this.#options.onStopListening();
          // A stop that cut Scout off is never asked: the bubble lets go.
          if (barged) this.#options.onDropped();
        } else {
          this.#resetRetry();
          this.#options.onHeard(question);
        }
        return;
      }
      if (!session.released) return;
      // The voice process ends sessions in order: a turnEnd is the oldest released question's.
      if (this.#taken || this.#released.values().next().value !== session) return;
      this.#taken = true;
      queueMicrotask(() => (this.#taken = false));
      session.live = false;
      this.#released.delete(session);
      if (text.trim() !== '') this.#options.onHeard(text.trim());
      else this.#options.onNothingHeard();
    });
    this.#session = session;
    session.mic = this.#options.openMic().then(
      (mic) => {
        if (this.#session !== session || !session.live) {
          mic.close();
          return null;
        }
        session.opened = true;
        ears.listen(mic);
        this.#options.onMicOpen?.(mode);
        return mic;
      },
      (error: unknown) => {
        session.live = false;
        if (this.#session === session) this.#session = null;
        this.#options.onMicFailed(error);
        return null;
      },
    );
  }
}
