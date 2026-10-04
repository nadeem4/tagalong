import type { SocketLike } from '../engine-connection';

type Listener = (event: { data?: unknown }) => void;

/**
 * A WebSocket double that does nothing on its own: the test opens it, feeds it frames,
 * and closes it, so every state the connection passes through is one the test chose.
 */
export class FakeSocket implements SocketLike {
  static readonly OPEN = 1;
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  closedByClient = false;
  readonly #listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: Listener): void {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closedByClient = true;
    this.serverClose();
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.#emit('open', {});
  }

  receive(message: unknown): void {
    this.#emit('message', { data: JSON.stringify(message) });
  }

  /** What a browser does when the engine goes away or never answered: error, then close. */
  fail(): void {
    this.#emit('error', {});
    this.serverClose();
  }

  serverClose(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.#emit('close', {});
  }

  /** The last request this socket sent with the given method. */
  lastRequest(method: string): Record<string, unknown> | undefined {
    return [...this.sent].reverse().find((message) => message.method === method);
  }

  #emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}
