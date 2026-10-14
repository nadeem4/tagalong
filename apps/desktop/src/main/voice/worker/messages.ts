import type { VoiceId } from '@tagalong/protocol';

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
    };

/** What the voice process sends back. */
export type FromWorker =
  | { kind: 'result'; id: number; value: unknown }
  | { kind: 'error'; id: number; message: string }
  | { kind: 'kokoro.ready' };

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
