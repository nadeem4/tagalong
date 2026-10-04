import type { ContextSnapshot, HostToCoreMethod, PerceptionTarget } from '@tagalong/protocol';
import type { ConnectionStatus } from './engine-connection';
import type { PageMessage, PortLike, WorkerMessage } from './port-messages';

export interface PortHubOptions {
  status: () => ConnectionStatus;
  call: (method: HostToCoreMethod, params: unknown) => Promise<unknown>;
  capture: (targets: readonly PerceptionTarget[]) => Promise<ContextSnapshot | null>;
}

/**
 * The service worker's side of every open extension page.
 *
 * Pages never open their own socket: the token stays in the worker, and there is one
 * connection to the engine however many side panels are open.
 */
export class PortHub {
  readonly #ports = new Set<PortLike>();
  readonly #options: PortHubOptions;
  /** A shortcut capture no panel was open to receive yet. */
  #undelivered: ContextSnapshot | null = null;

  constructor(options: PortHubOptions) {
    this.#options = options;
  }

  add(port: PortLike): void {
    this.#ports.add(port);
    port.onDisconnect.addListener(() => this.#ports.delete(port));
    port.onMessage.addListener((message) => void this.#handle(port, message));
    port.postMessage({ type: 'status', status: this.#options.status() } satisfies WorkerMessage);
    if (this.#undelivered !== null) {
      port.postMessage({ type: 'context', snapshot: this.#undelivered } satisfies WorkerMessage);
      this.#undelivered = null;
    }
  }

  /** True while any extension page is open — the side panel, usually. */
  get hasPages(): boolean {
    return this.#ports.size > 0;
  }

  broadcast(message: WorkerMessage): void {
    for (const port of this.#ports) port.postMessage(message);
  }

  /**
   * Hands the shortcut's capture to the open panels — or, when the shortcut is what is
   * opening the panel, keeps it until that panel connects.
   */
  publishContext(snapshot: ContextSnapshot | null): void {
    if (this.#ports.size === 0) {
      if (snapshot === null) return;
      this.#undelivered = snapshot;
      return;
    }
    this.broadcast({ type: 'context', snapshot });
  }

  async #handle(port: PortLike, raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null) return;
    const message = raw as PageMessage;
    if (message.type !== 'call' && message.type !== 'capture') return;
    try {
      const result =
        message.type === 'call'
          ? await this.#options.call(message.method, message.params)
          : await this.#options.capture(message.targets);
      port.postMessage({ type: 'reply', id: message.id, ok: true, result } satisfies WorkerMessage);
    } catch (error) {
      port.postMessage({
        type: 'reply',
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerMessage);
    }
  }
}
