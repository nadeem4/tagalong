/**
 * A BrainSocket double for the body tests: it records what the body sends and lets the
 * test open it, answer the hello and push frames, so every state is one the test chose.
 */
import type { BrainSocket } from '@tagalong/contract';
import type { StorageArea } from '../layer/api';

export class FakeBrainSocket implements BrainSocket {
  readonly sent: Record<string, unknown>[] = [];
  closed = false;
  private openHandler: () => void = () => undefined;
  private messageHandler: (data: string) => void = () => undefined;
  private closeHandler: () => void = () => undefined;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
    this.closeHandler();
  }
  onOpen(f: () => void): void {
    this.openHandler = f;
  }
  onMessage(f: (data: string) => void): void {
    this.messageHandler = f;
  }
  onClose(f: () => void): void {
    this.closeHandler = f;
  }

  open(): void {
    this.openHandler();
  }
  receive(message: unknown): void {
    this.messageHandler(JSON.stringify(message));
  }
  /** The first request the body sent with this method. */
  request(method: string): Record<string, unknown> | undefined {
    return this.sent.find((m) => m['method'] === method);
  }
  /** Answers the body's hello, which puts it online. */
  acceptHello(): void {
    this.receive({
      jsonrpc: '2.0',
      id: this.request('hello')?.['id'],
      result: { protocol: 1, session: 's1', tools: [], seq: 0, resync: false },
    });
  }
}

/** In-memory StorageArea. */
export function memoryStorage(initial: Record<string, unknown> = {}): StorageArea {
  const data = new Map(Object.entries(initial));
  return {
    get: (key) => Promise.resolve(data.get(key)),
    set: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

/** Lets pending promise callbacks run (the client reads its seq store before hello). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
