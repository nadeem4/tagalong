/**
 * RemoteEars: the Ears interface for a renderer window. The ears run in the voice process;
 * mic frames go out and heard words come back over IPC. Used by talk.ts, voice-seam.ts and
 * onboarding.tsx.
 */
import type { Ears, EarsEvent, ListenMode, MicStream } from '@tagalong/protocol';
import type { TagalongHostApi } from '../../shared/ipc';

type EarsHost = Pick<TagalongHostApi, 'earsListen' | 'micFrame' | 'earsStop' | 'onEarsEvent'>;

/** The ears as a window sees them. */
export class RemoteEars implements Ears {
  readonly #host: EarsHost;
  readonly #mode: ListenMode;
  readonly #unsubscribe: (() => void)[] = [];
  #run = 0;

  constructor(host: EarsHost, mode: ListenMode) {
    this.#host = host;
    this.#mode = mode;
  }

  on(event: EarsEvent, handler: (text?: string) => void): void {
    this.#unsubscribe.push(
      this.#host.onEarsEvent((said, text) => {
        if (said === event) handler(text);
      }),
    );
  }

  listen(mic: MicStream): void {
    const run = ++this.#run;
    void this.#host
      .earsListen(this.#mode)
      .catch((error: unknown) => console.warn('[ears] could not start', error));
    void (async () => {
      for await (const frame of mic) {
        if (run !== this.#run) return;
        this.#host.micFrame(frame);
      }
    })();
  }

  /**
   * Stops listening. Held, the question's words arrive after the stop, as its turnEnd: the
   * handlers stay until then. Always listening lets go at once.
   */
  stop(): void {
    this.#run += 1;
    void this.#host.earsStop().catch(() => undefined);
    const release = (): void => {
      for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    };
    if (this.#mode === 'always') release();
    else {
      this.#unsubscribe.push(
        this.#host.onEarsEvent((said) => {
          if (said === 'turnEnd') queueMicrotask(release);
        }),
      );
    }
  }
}
