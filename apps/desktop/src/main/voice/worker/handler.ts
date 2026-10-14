import type { LazyLocalVoice } from '../voice';
import type { EarsMessage } from './ears-host';
import type { FromWorker, ToWorker } from './messages';

export interface WorkerDeps {
  kokoro: Pick<LazyLocalVoice, 'warm' | 'loaded' | 'speak'>;
  ears: (message: EarsMessage) => void;
}

/** The voice process's side: runs each call and posts its answer, or why it failed. */
export function createWorkerHandler(deps: WorkerDeps, post: (message: FromWorker) => void) {
  let toldReady = false;
  const run = async (message: Extract<ToWorker, { kind: 'call' }>): Promise<unknown> => {
    switch (message.method) {
      case 'kokoro.warm': {
        deps.kokoro.warm();
        const ok = await deps.kokoro.loaded();
        if (ok && !toldReady) {
          toldReady = true;
          post({ kind: 'kokoro.ready' });
        }
        return ok;
      }
      case 'kokoro.speak':
        return deps.kokoro.speak(message.text, { voice: message.voice, speed: message.speed });
    }
  };
  return (message: ToWorker): void => {
    if (message.kind !== 'call') {
      deps.ears(message);
      return;
    }
    run(message).then(
      (value) => post({ kind: 'result', id: message.id, value }),
      (error: unknown) =>
        post({
          kind: 'error',
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  };
}
