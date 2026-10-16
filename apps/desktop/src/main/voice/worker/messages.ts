/**
 * The messages between main and the voice process. Contains ToWorker, FromWorker, WorkerCall and
 * WorkerProcess.
 */

import type { EarsEvent, ListenMode, VoiceId } from '@tagalong/protocol';

/** What main sends the voice process. */
export type ToWorker =
  | { kind: 'call'; id: number; method: 'kokoro.warm' }
  | {
      kind: 'call';
      id: number;
      method: 'kokoro.speak';
      text: string;
      voice: VoiceId;
      speed: number;
    }
  | { kind: 'call'; id: number; method: 'ears.ensure' }
  | { kind: 'ears.listen'; mode: ListenMode }
  | { kind: 'ears.frame'; samples: Float32Array }
  | { kind: 'ears.stop' };

/** What the voice process sends back. */
export type FromWorker =
  | { kind: 'result'; id: number; value: unknown }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'kokoro.ready' }
  | { kind: 'ears'; event: EarsEvent; text?: string }
  | { kind: 'ears.status'; status: 'loading' | 'ready' | 'failed'; message?: string }
  | { kind: 'ears.progress'; fraction: number };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A call, before the client numbers it. */
export type WorkerCall = DistributiveOmit<Extract<ToWorker, { kind: 'call' }>, 'id'>;

/** The slice of Electron's UtilityProcess the client uses; a fake in tests. */
export interface WorkerProcess {
  postMessage(message: ToWorker): void;
  on(event: 'message', listener: (message: FromWorker) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  kill(): boolean;
}
