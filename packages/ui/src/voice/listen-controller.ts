import { addressedToScout, isStopListening } from '@tagalong/protocol';
import type { Ears, ListenMode, MicStream } from '@tagalong/protocol';

/** The open microphone, as the controller needs it: its frames, and a way to close it. */
export type ListenMic = MicStream & { close(): void };

export interface ListenControllerOptions {
  ears(mode: ListenMode): Ears;
  openMic(): Promise<ListenMic>;
  /** Speech started: Scout stops talking. */
  onSpeechStart(): void;
  /** The words heard so far. */
  onPartial(text: string): void;
  onHeard(text: string): void;
  onNothingHeard(): void;
  onMicFailed(error: unknown): void;
  /** "Scout, stop" was heard while listening all the time. */
  onStopListening(): void;
  /** A turn that had stopped Scout ended with nothing to send. */
  onDropped(): void;
}

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
 * on (`setAlways`) it stays open, except during a call or full screen (`setPaused`) and while
 * the system voice speaks (`setDeaf`). Nothing heard after a session ends reaches the bubble.
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

  constructor(options: ListenControllerOptions) {
    this.#options = options;
  }

  get mode(): ListenMode | null {
    return this.#session?.mode ?? null;
  }

  hold(): void {
    if (this.#session !== null) return;
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
   * (models that failed to load, a voice process that died): none of them is heard later.
   */
  cancel(): void {
    for (const waiting of this.#released) waiting.live = false;
    this.#released.clear();
    this.#end();
  }

  /** Always listening, as the person switched it. */
  setAlways(on: boolean): void {
    this.#always = on;
    this.#sync();
  }

  /** A call or a full-screen window: the mic closes until it is over. */
  setPaused(paused: boolean): void {
    this.#paused = paused;
    this.#sync();
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

  /** Ends the current session at once: the mic closes and nothing it hears counts. */
  #end(): void {
    const session = this.#session;
    if (session === null) return;
    this.#session = null;
    session.live = false;
    void session.mic.then((mic) => mic?.close());
    // A mic that never opened never listened: a stop now could end another session.
    if (session.opened) session.ears.stop();
  }

  /**
   * Always: words heard while a released question still waits are that question's, as the
   * voice process runs sessions in order; only talk addressed to Scout counts, and it cuts
   * Scout off once per turn.
   */
  #addressed(session: Session, text: string): string | null {
    if (this.#taken || this.#released.size > 0) return null;
    const question = addressedToScout(text);
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
      if (mode === 'always' && this.#addressed(session, text) === null) return;
      this.#options.onPartial(text);
    });
    ears.on('turnEnd', (text = '') => {
      if (!session.live) return;
      if (mode === 'always') {
        const barged = session.barged;
        const question = this.#addressed(session, text);
        session.barged = false;
        if (question === null) {
          // The final words dropped the name (or came back empty): the bubble lets go.
          if (barged) this.#options.onDropped();
          return;
        }
        if (isStopListening(question)) this.#options.onStopListening();
        else this.#options.onHeard(question);
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
