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
}

/**
 * When the microphone is open, and what happens to what it hears. The mic opens only on
 * `hold` (the talk key, the mic button) and closes on `release` or `cancel`; nothing heard
 * after a session ends reaches the bubble.
 */
export class ListenController {
  readonly #options: ListenControllerOptions;
  #session: Session | null = null;
  /** Released held questions still waiting for their words; cancel drops them too. */
  readonly #released = new Set<Session>();

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
      return;
    }
    session.released = true;
    this.#released.add(session);
    session.ears.stop();
  }

  /**
   * Drops the question being asked, and any released question whose words have not come
   * (models that failed to load, a voice process that died): none of them is heard later.
   */
  cancel(): void {
    for (const waiting of this.#released) waiting.live = false;
    this.#released.clear();
    const session = this.#session;
    if (session === null) return;
    this.#session = null;
    session.live = false;
    void session.mic.then((mic) => mic?.close());
    session.ears.stop();
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
    };
    ears.on('speechStart', () => {
      if (session.live) this.#options.onSpeechStart();
    });
    ears.on('partial', (text) => {
      if (session.live && text !== undefined && text !== '') this.#options.onPartial(text);
    });
    ears.on('turnEnd', (text = '') => {
      if (!session.live || (session.mode === 'held' && !session.released)) return;
      if (session.mode === 'held') {
        session.live = false;
        this.#released.delete(session);
      }
      if (text.trim() !== '') this.#options.onHeard(text.trim());
      else if (session.mode === 'held') this.#options.onNothingHeard();
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
