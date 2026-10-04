import { coreToHostNotifications } from '@tagalong/protocol';
import type { ContextSnapshot, HostToCoreMethod, PerceptionTarget } from '@tagalong/protocol';
import type { HostBridge, TurnEvent } from '@tagalong/ui';
import type { ConnectionStatus } from './engine-connection';
import type { PageMessage, PortLike, WorkerMessage } from './port-messages';

/** The side panel's bridge: the HostBridge the shared UI needs, plus the extension's extras. */
export interface PortBridge extends HostBridge {
  /** Called at once with the last status, then on every change. Returns an unsubscribe. */
  onStatus(handler: (status: ConnectionStatus) => void): () => void;
  /** A capture the shortcut or a tab switch made for this panel; null clears the chip. */
  onContext(handler: (snapshot: ContextSnapshot | null) => void): () => void;
}

/** Under the thirty seconds Chrome gives an idle service worker. */
const PING_MS = 20_000;

/**
 * `HostBridge` over a `chrome.runtime` port to the service worker.
 *
 * The panel never holds the pairing token or a socket. Every engine call is relayed by the
 * worker, which is also what lets a panel open while the app is down show that state
 * instead of failing to construct.
 */
export function createPortBridge(port: PortLike): PortBridge {
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const turnHandlers = new Set<(event: TurnEvent) => void>();
  const statusHandlers = new Set<(status: ConnectionStatus) => void>();
  const contextHandlers = new Set<(snapshot: ContextSnapshot | null) => void>();
  let lastStatus: ConnectionStatus | null = null;

  const ping = setInterval(() => port.postMessage({ type: 'ping' } satisfies PageMessage), PING_MS);

  port.onMessage.addListener((raw) => {
    const message = raw as WorkerMessage;
    switch (message.type) {
      case 'reply': {
        const waiting = pending.get(message.id);
        if (waiting === undefined) return;
        pending.delete(message.id);
        if (message.ok) waiting.resolve(message.result);
        else waiting.reject(new Error(message.error));
        return;
      }
      case 'status':
        lastStatus = message.status;
        for (const handler of statusHandlers) handler(message.status);
        return;
      case 'context':
        for (const handler of contextHandlers) handler(message.snapshot);
        return;
      case 'notification': {
        const forPanel =
          message.method.startsWith('turn.') ||
          message.method === 'pet.message' ||
          message.method === 'crew.status';
        if (!forPanel || !(message.method in coreToHostNotifications)) return;
        const event = { type: message.method, ...(message.params as object) } as TurnEvent;
        for (const handler of turnHandlers) handler(event);
        return;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    clearInterval(ping);
    for (const [id, waiting] of pending) {
      pending.delete(id);
      waiting.reject(new Error('the extension restarted; reopen the side panel'));
    }
  });

  function send(message: PageMessage & { id: number }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
      port.postMessage(message);
    });
  }

  function call(method: HostToCoreMethod, params: unknown): Promise<unknown> {
    return send({ type: 'call', id: nextId++, method, params });
  }

  function subscribe<T>(set: Set<T>, handler: T): () => void {
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }

  return {
    async ask(input) {
      const result = await call('ask', {
        petId: input.petId,
        ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
        input: { text: input.text ?? '' },
        ...(input.snapshot !== undefined ? { snapshot: input.snapshot } : {}),
      });
      return result as { turnId: string };
    },
    async capture(targets: readonly PerceptionTarget[]) {
      return (await send({ type: 'capture', id: nextId++, targets })) as ContextSnapshot | null;
    },
    async interrupt(turnId) {
      await call('interrupt', { turnId });
    },
    async listPets() {
      const result = (await call('pets.list', {})) as {
        pets: Awaited<ReturnType<HostBridge['listPets']>>;
      };
      return result.pets;
    },
    onTurnEvent: (handler) => subscribe(turnHandlers, handler),
    onStatus(handler) {
      if (lastStatus !== null) handler(lastStatus);
      return subscribe(statusHandlers, handler);
    },
    onContext: (handler) => subscribe(contextHandlers, handler),
  };
}
