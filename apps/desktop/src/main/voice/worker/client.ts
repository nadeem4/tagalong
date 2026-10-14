import type { FromWorker, ToWorker, WorkerCall, WorkerProcess } from './messages';

/**
 * Main's end of the voice process. The process starts when first needed: at launch if an
 * earlier run downloaded Kokoro, otherwise on Scout's first line. If it dies, every call still waiting fails at once (the line falls to the next
 * voice), listeners hear about it, and the next call starts a fresh process.
 */
export class VoiceWorker {
  readonly #spawn: () => WorkerProcess;
  #child: WorkerProcess | null = null;
  #nextId = 1;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  readonly #listeners = new Set<(message: FromWorker) => void>();
  readonly #exits = new Set<() => void>();

  constructor(spawn: () => WorkerProcess) {
    this.#spawn = spawn;
  }

  call(request: WorkerCall): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#process().postMessage({ ...request, id } as ToWorker);
    });
  }

  send(message: Exclude<ToWorker, { kind: 'call' }>): void {
    this.#process().postMessage(message);
  }

  onMessage(listener: (message: FromWorker) => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  onExit(listener: () => void): () => void {
    this.#exits.add(listener);
    return () => void this.#exits.delete(listener);
  }

  stop(): void {
    this.#child?.kill();
  }

  #process(): WorkerProcess {
    if (this.#child !== null) return this.#child;
    const child = this.#spawn();
    child.on('message', (message) => this.#receive(message));
    child.on('exit', () => this.#exited(child));
    this.#child = child;
    return child;
  }

  #receive(message: FromWorker): void {
    if (message.kind === 'result' || message.kind === 'error') {
      const waiting = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.kind === 'result') waiting?.resolve(message.value);
      else waiting?.reject(new Error(message.message));
      return;
    }
    for (const listener of [...this.#listeners]) listener(message);
  }

  #exited(child: WorkerProcess): void {
    if (this.#child !== child) return;
    this.#child = null;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const call of pending) call.reject(new Error('The voice process stopped.'));
    for (const listener of [...this.#exits]) listener();
  }
}
