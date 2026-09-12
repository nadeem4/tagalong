import { coreToHostNotifications, engineUrl, resultSchemaFor } from '@tagalong/protocol';
import type {
  ContextSnapshotPatch,
  CoreToHostNotification,
  HostCapability,
  HostToCoreMethod,
  ParamsOf,
  PerceptionTarget,
  ResultOf,
} from '@tagalong/protocol';

/** A core-to-host notification, still in wire shape, on its way to a renderer. */
export interface EngineNotification {
  method: CoreToHostNotification;
  params: unknown;
}

export interface EngineClientOptions {
  port: number;
  token: string;
  hostVersion: string;
  capabilities: readonly HostCapability[];
  /** Answers perception.capture, which is how a pet looks at the screen mid-turn. */
  capture: (what: readonly PerceptionTarget[]) => Promise<ContextSnapshotPatch>;
  onNotification: (notification: EngineNotification) => void;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/** How long a call waits before giving up, so a wedged engine cannot hang the UI. */
const CALL_TIMEOUT_MS = 30_000;

/**
 * The desktop host's one and only connection to the engine.
 *
 * The engine runs in this very process, but hosts still speak it through the socket:
 * keeping a single client here — rather than letting each renderer dial in — is what
 * makes the Electron host and the Chrome host interchangeable, and what keeps the
 * pairing token out of every window.
 */
export class EngineClient {
  readonly #socket: WebSocket;
  readonly #pending = new Map<string, Pending>();
  readonly #options: EngineClientOptions;
  #nextId = 1;

  private constructor(socket: WebSocket, options: EngineClientOptions) {
    this.#socket = socket;
    this.#options = options;
    socket.addEventListener('message', (event) => this.#receive(String(event.data)));
    socket.addEventListener('close', () => {
      for (const [id, pending] of this.#pending) {
        this.#pending.delete(id);
        pending.reject(new Error('the engine connection closed'));
      }
    });
  }

  static async connect(options: EngineClientOptions): Promise<EngineClient> {
    const socket = new WebSocket(engineUrl(options.port));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('could not reach the engine')), {
        once: true,
      });
    });

    const client = new EngineClient(socket, options);
    await client.call('hello', {
      host: 'desktop',
      version: options.hostVersion,
      capabilities: [...options.capabilities],
      token: options.token,
    });
    return client;
  }

  /** Sends a request and resolves with the validated result for that method. */
  async call<M extends HostToCoreMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const id = `desktop-${this.#nextId++}`;
    const raw = await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`the engine did not answer ${method} within ${CALL_TIMEOUT_MS}ms`));
      }, CALL_TIMEOUT_MS);

      this.#pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });

    return resultSchemaFor(method).parse(raw) as ResultOf<M>;
  }

  close(): void {
    this.#socket.close();
  }

  #receive(raw: string): void {
    let message: {
      id?: string;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      console.error('[engine-client] engine sent a message that was not JSON');
      return;
    }

    if (message.method !== undefined && message.id !== undefined) {
      void this.#answer(message.id, message.method, message.params);
      return;
    }

    if (message.method !== undefined) {
      if (message.method in coreToHostNotifications) {
        this.#options.onNotification({
          method: message.method as CoreToHostNotification,
          params: message.params,
        });
      }
      return;
    }

    if (message.id === undefined) return;
    const pending = this.#pending.get(message.id);
    if (pending === undefined) return;
    this.#pending.delete(message.id);
    if (message.error !== undefined) {
      pending.reject(new Error(message.error.message ?? 'the engine returned an error'));
    } else {
      pending.resolve(message.result);
    }
  }

  /** The one core-to-host request in Phase 1: the engine asking this host to look. */
  async #answer(id: string, method: string, params: unknown): Promise<void> {
    if (method !== 'perception.capture') {
      this.#send({ jsonrpc: '2.0', id, error: { code: -32601, message: `unknown ${method}` } });
      return;
    }
    try {
      const what = (params as { what?: PerceptionTarget[] }).what ?? [];
      const snapshot = await this.#options.capture(what);
      this.#send({ jsonrpc: '2.0', id, result: { snapshot } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
    }
  }

  #send(payload: unknown): void {
    this.#socket.send(JSON.stringify(payload));
  }
}
