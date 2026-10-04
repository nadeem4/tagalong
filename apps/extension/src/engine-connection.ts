import {
  HelloResult,
  RPC_ERROR_CODES,
  coreToHostNotifications,
  engineUrl,
  resultSchemaFor,
} from '@tagalong/protocol';
import type {
  CoreToHostNotification,
  HostCapability,
  HostToCoreMethod,
  ParamsOf,
  Pet,
  ResultOf,
} from '@tagalong/protocol';
import type { Pairing } from './pairing';

/** The slice of the browser WebSocket this module uses, so a test can hand in a fake. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data?: unknown }) => void): void;
}

/** What the side panel shows. Every state names itself, so the panel never guesses. */
export type ConnectionStatus =
  | { state: 'unpaired' }
  | { state: 'connecting' }
  | { state: 'connected'; engineVersion: string; pets: Pet[] }
  | { state: 'disconnected'; reason: string; retryInMs: number }
  /** The engine refused the token. Retrying cannot fix that; re-pairing can. */
  | { state: 'rejected'; reason: string };

export interface EngineConnectionOptions {
  readPairing: () => Promise<Pairing | null>;
  createSocket: (url: string) => SocketLike;
  hostVersion: string;
  capabilities: readonly HostCapability[];
  /** Answers a core-to-host request — `perception.capture` and friends. */
  answer: (method: string, params: unknown) => Promise<unknown>;
  onNotification: (method: CoreToHostNotification, params: unknown) => void;
  onStatus: (status: ConnectionStatus) => void;
  /** How long a call waits for the engine. */
  callTimeoutMs?: number;
  /** How often a connected socket proves the engine is still answering. */
  heartbeatMs?: number;
}

const OPEN = 1;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
/**
 * Under Chrome's thirty-second idle limit for a service worker. Since Chrome 116 socket
 * traffic resets that timer, so this is also what keeps the worker — and with it the
 * engine's route to the browser — alive between asks.
 */
const DEFAULT_HEARTBEAT_MS = 20_000;
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** One second, doubling, capped at thirty: quick to notice the app is back, quiet when it is not. */
export function reconnectDelay(attempt: number): number {
  return Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * The extension's one socket to the engine, owned by the service worker.
 *
 * It never gives up on its own: the extension is useless without the desktop app, so a
 * missing app is a state to wait out, shown in the side panel, not an error to report and
 * stop. The one exception is a rejected token, where retrying is pointless until the
 * user pairs again.
 */
export class EngineConnection {
  readonly #options: EngineConnectionOptions;
  #socket: SocketLike | null = null;
  #status: ConnectionStatus = { state: 'connecting' };
  #attempt = 0;
  #nextId = 1;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  readonly #pending = new Map<string, Pending>();

  constructor(options: EngineConnectionOptions) {
    this.#options = options;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  /** Connects if nothing is already up or on its way. Safe to call on every wake. */
  async start(): Promise<void> {
    if (this.#socket !== null || this.#retryTimer !== null) return;
    if (this.#status.state === 'rejected') return;
    await this.#connect();
  }

  /** Drops whatever is up and dials again — used when the pairing changes. */
  async restart(): Promise<void> {
    this.#teardown();
    this.#attempt = 0;
    await this.#connect();
  }

  async call<M extends HostToCoreMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
    const raw = await this.#request(method, params);
    return resultSchemaFor(method).parse(raw) as ResultOf<M>;
  }

  async #connect(): Promise<void> {
    const pairing = await this.#options.readPairing();
    if (pairing === null) {
      this.#setStatus({ state: 'unpaired' });
      return;
    }
    this.#setStatus({ state: 'connecting' });

    const socket = this.#options.createSocket(engineUrl(pairing.port));
    this.#socket = socket;

    socket.addEventListener('open', () => {
      this.#request('hello', {
        host: 'extension',
        version: this.#options.hostVersion,
        capabilities: [...this.#options.capabilities],
        token: pairing.token,
      })
        .then((raw) => {
          const hello = HelloResult.parse(raw);
          this.#attempt = 0;
          this.#setStatus({
            state: 'connected',
            engineVersion: hello.engineVersion,
            pets: hello.pets,
          });
          this.#startHeartbeat();
        })
        .catch((error: unknown) => {
          // A rejected token was already handled where the reply arrived; anything else is
          // a broken handshake, and closing the socket sends it down the retry path.
          if (!(error instanceof RpcFailure && error.code === RPC_ERROR_CODES.unauthorized)) {
            socket.close();
          }
        });
    });
    socket.addEventListener('message', (event) => this.#receive(socket, String(event.data)));
    // A browser fires error and then close; close alone carries the decision.
    socket.addEventListener('error', () => undefined);
    socket.addEventListener('close', () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#stopHeartbeat();
      this.#failPending('the engine connection closed');
      if (this.#status.state === 'rejected') return;
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect(): void {
    const delay = reconnectDelay(this.#attempt);
    this.#attempt += 1;
    this.#setStatus({
      state: 'disconnected',
      reason: 'could not reach the Tagalong app',
      retryInMs: delay,
    });
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      void this.#connect();
    }, delay);
  }

  #startHeartbeat(): void {
    this.#stopHeartbeat();
    const interval = this.#options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.#heartbeatTimer = setInterval(() => {
      this.call('pets.list', {})
        .then(({ pets }) => {
          if (this.#status.state === 'connected') this.#setStatus({ ...this.#status, pets });
        })
        .catch(() => {
          // An engine that stopped answering is down, whatever the socket says.
          this.#socket?.close();
        });
    }, interval);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== null) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  #teardown(): void {
    if (this.#retryTimer !== null) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#stopHeartbeat();
    const socket = this.#socket;
    this.#socket = null;
    this.#failPending('the engine connection was restarted');
    socket?.close();
    if (this.#status.state === 'rejected') this.#status = { state: 'connecting' };
  }

  #request(method: string, params: unknown): Promise<unknown> {
    const socket = this.#socket;
    if (socket === null || socket.readyState !== OPEN) {
      return Promise.reject(new Error(`not connected to the Tagalong app (${this.#status.state})`));
    }
    const id = `extension-${this.#nextId++}`;
    const timeoutMs = this.#options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`the engine did not answer ${method} within ${timeoutMs}ms`));
      }, timeoutMs);
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
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  #failPending(reason: string): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id);
      pending.reject(new Error(reason));
    }
  }

  #receive(socket: SocketLike, raw: string): void {
    let message: {
      id?: string | number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      message = JSON.parse(raw) as typeof message;
    } catch {
      return;
    }

    if (message.method !== undefined && message.id !== undefined) {
      void this.#answer(socket, message.id, message.method, message.params);
      return;
    }
    if (message.method !== undefined) {
      if (message.method in coreToHostNotifications) {
        this.#options.onNotification(message.method as CoreToHostNotification, message.params);
      }
      return;
    }
    if (message.id === undefined) return;
    const pending = this.#pending.get(String(message.id));
    if (pending === undefined) return;
    this.#pending.delete(String(message.id));
    if (message.error !== undefined) {
      // Decided here, synchronously, because the engine closes the socket straight after
      // this reply and the close must already know not to retry.
      if (message.error.code === RPC_ERROR_CODES.unauthorized) {
        this.#setStatus({
          state: 'rejected',
          reason: 'The Tagalong app rejected the pairing token. Paste the current one.',
        });
      }
      pending.reject(
        new RpcFailure(message.error.code ?? 0, message.error.message ?? 'the engine failed'),
      );
    } else {
      pending.resolve(message.result);
    }
  }

  async #answer(
    socket: SocketLike,
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const result = await this.#options.answer(method, params);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } }));
    }
  }

  #setStatus(status: ConnectionStatus): void {
    this.#status = status;
    this.#options.onStatus(status);
  }
}

/** An error the engine returned, keeping its code so hello can tell a bad token apart. */
class RpcFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}
