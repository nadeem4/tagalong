/**
 * The voice process's ears: one listening session at a time, buffering frames while the models
 * load. Contains createEarsHost and the failure lines the bubble shows.
 */

import { Pushable } from '@tagalong/ui/shapes';
import type { Ears, EarsEvent, ListenMode } from '@tagalong/ui/shapes';
import { FakeEars } from '../ears/fake-ears';
import { LocalEars } from '../ears/local-ears';
import { ModelIntegrityError } from '../ears/model-files';
import type { EarsParts } from '../ears/local-ears';
import type { FromWorker, ToWorker } from './messages';

/** Frames kept while the models load: about 30 s, then the oldest go. */
export const MAX_BUFFERED_FRAMES = 940;

/** What the panel says when the models cannot be fetched (offline, the first time). */
export const EARS_DOWNLOAD_FAILED = 'Speech models didn’t download. Check the internet connection.';
/** What it says when a download failed its checksum twice (the file was not kept). */
export const EARS_MODEL_DAMAGED = 'The speech model download was damaged. Check the connection.';
/** What it says when models already on disk cannot start. */
export const EARS_START_FAILED = 'Listening couldn’t start. It retries on its own.';

export type EarsMessage = Extract<ToWorker, { kind: 'ears.listen' | 'ears.frame' | 'ears.stop' }>;

/**
 * The voice process's ears. A listen opens an inbox for frames at once, so the first
 * words are not lost while the models load (the first time, a download). One listening
 * session at a time; the audio is never written anywhere.
 */
export function createEarsHost(options: {
  fake: boolean;
  load: () => Promise<EarsParts>;
  post: (message: FromWorker) => void;
  /** The models are on disk already: no first-time download to tell about. */
  filesPresent?: () => boolean;
}): (message: EarsMessage) => void {
  let parts: Promise<EarsParts> | null = null;
  /** The load under way includes the first-time download. */
  let downloading = false;
  interface Session {
    mode: ListenMode;
    ears: Ears | null;
    inbox: Pushable<Float32Array>;
    superseded: boolean;
    stopped: boolean;
    /** Resolves when the session has finished with the models. */
    finish: () => void;
  }
  let session: Session | null = null;
  // Sessions run one after another: the models hold state, so two must never share them.
  let previous: Promise<void> = Promise.resolve();

  /**
   * Stop or replace a session; a session that never made it to the ears is finished now. A
   * held question let go only ends its inbox: the ears hear the frames still queued (behind
   * a slow decode) and end the turn when the inbox runs dry, so the last words are kept.
   */
  const end = (current: Session, superseded: boolean): void => {
    current.superseded = superseded;
    current.stopped = true;
    if (superseded || current.mode === 'always') current.ears?.stop();
    current.inbox.end();
    if (current.ears === null ? superseded || current.mode === 'always' : current.mode === 'always')
      current.finish();
  };

  const wire = (ears: Ears): Ears => {
    for (const event of ['speechStart', 'partial', 'final', 'turnEnd'] as EarsEvent[])
      ears.on(event, (text) =>
        options.post(text === undefined ? { kind: 'ears', event } : { kind: 'ears', event, text }),
      );
    return ears;
  };

  return (message) => {
    if (message.kind === 'ears.frame') {
      session?.inbox.push(message.samples);
      return;
    }
    if (message.kind === 'ears.stop') {
      const current = session;
      session = null;
      if (current === null) return;
      end(current, false);
      return;
    }
    if (session !== null) end(session, true);
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => (finish = resolve));
    const current: Session = {
      mode: message.mode,
      ears: null,
      inbox: new Pushable<Float32Array>(MAX_BUFFERED_FRAMES),
      superseded: false,
      stopped: false,
      finish,
    };
    session = current;
    if (options.fake) {
      current.ears = wire(new FakeEars(message.mode));
      current.ears.listen(current.inbox);
      return;
    }
    const after = previous;
    // Even a session skipped at once finishes only after the one before it.
    previous = after.then(() => done);
    if (parts === null) {
      downloading = !(options.filesPresent?.() ?? false);
      if (downloading) options.post({ kind: 'ears.status', status: 'loading' });
      parts = options.load();
    }
    const loading = parts;
    /**
     * The ears could not be built, or a model broke while always listening: nothing hears the
     * mic, so the panel is told (and stops showing listening) and the next listen loads again.
     */
    const failed = (error: unknown): void => {
      console.warn('[ears] listening stopped: a model failed', error);
      if (parts === loading) parts = null;
      current.finish();
      options.post({ kind: 'ears.status', status: 'failed', message: EARS_START_FAILED });
    };
    loading.then(
      (loaded) => {
        if (!current.superseded) options.post({ kind: 'ears.status', status: 'ready' });
        void after.then(() => {
          if (current.superseded || (current.stopped && current.mode === 'always')) {
            current.finish();
            return;
          }
          // A session stopped before this point has an ended inbox: its buffered words still
          // play through, and the mic ending ends the turn.
          try {
            const ears = wire(new LocalEars(loaded, current.mode, (error) => failed(error)));
            if (current.mode === 'held') ears.on('turnEnd', current.finish);
            ears.listen(current.inbox);
            // Kept only once it listens: ears that never started are never stopped.
            current.ears = ears;
          } catch (error) {
            failed(error);
          }
        });
      },
      (error: unknown) => {
        if (parts === loading) parts = null;
        current.finish();
        console.warn('[ears] the models could not load', error);
        options.post({
          kind: 'ears.status',
          status: 'failed',
          message:
            error instanceof ModelIntegrityError
              ? EARS_MODEL_DAMAGED
              : downloading
                ? EARS_DOWNLOAD_FAILED
                : EARS_START_FAILED,
        });
      },
    );
  };
}
