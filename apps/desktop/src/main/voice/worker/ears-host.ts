import { Pushable } from '@tagalong/protocol';
import type { Ears, EarsEvent } from '@tagalong/protocol';
import { FakeEars } from '../ears/fake-ears';
import { LocalEars } from '../ears/local-ears';
import type { EarsParts } from '../ears/local-ears';
import type { FromWorker, ToWorker } from './messages';

/** Frames kept while the models load: about 30 s, then the oldest go. */
export const MAX_BUFFERED_FRAMES = 940;

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
}): (message: EarsMessage) => void {
  let parts: Promise<EarsParts> | null = null;
  let session: { ears: Ears | null; inbox: Pushable<Float32Array>; stopped: boolean } | null = null;

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
      current.stopped = true;
      current.ears?.stop();
      current.inbox.end();
      return;
    }
    session?.ears?.stop();
    session?.inbox.end();
    const current = {
      ears: null as Ears | null,
      inbox: new Pushable<Float32Array>(MAX_BUFFERED_FRAMES),
      stopped: false,
    };
    session = current;
    if (options.fake) {
      current.ears = wire(new FakeEars(message.mode));
      current.ears.listen(current.inbox);
      return;
    }
    if (parts === null) options.post({ kind: 'ears.status', status: 'loading' });
    parts ??= options.load();
    parts.then(
      (loaded) => {
        options.post({ kind: 'ears.status', status: 'ready' });
        current.ears = wire(new LocalEars(loaded, message.mode));
        current.ears.listen(current.inbox);
        if (current.stopped) current.ears.stop();
      },
      (error: unknown) => {
        parts = null;
        options.post({
          kind: 'ears.status',
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
  };
}
