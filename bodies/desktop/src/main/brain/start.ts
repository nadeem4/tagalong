/**
 * Starts the desktop's brain client on a real websocket. The desktop does not launch the
 * brain; it dials the address the brain listens on (TAGALONG_BRAIN_ADDR, the same variable)
 * and BrainClient keeps retrying while it is down. No tools are declared yet.
 */
import { BrainClient } from './brain-client';
import type { BrainClientOptions, BrainSocket } from './brain-client';

const DEFAULT_ADDR = '127.0.0.1:47321';

export type StartBrainOptions = Pick<
  BrainClientOptions,
  'onNotification' | 'onStatus' | 'onResync'
> & {
  env?: NodeJS.ProcessEnv;
  /** Tests pass a fake; the app uses the global WebSocket. */
  openSocket?: BrainClientOptions['openSocket'];
};

function webSocket(url: string): BrainSocket {
  const ws = new WebSocket(url);
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onOpen: (f) => ws.addEventListener('open', () => f()),
    onMessage: (f) =>
      ws.addEventListener('message', (event) => {
        if (typeof event.data === 'string') f(event.data);
      }),
    // An error is always followed by close, which is where reconnecting starts.
    onClose: (f) => ws.addEventListener('close', () => f()),
  };
}

export function startBrain(options: StartBrainOptions): BrainClient {
  const { env = process.env, openSocket = webSocket, ...handlers } = options;
  const brain = new BrainClient({
    ...handlers,
    addr: env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR,
    tools: () => [],
    openSocket,
    onUse: () => Promise.reject(new Error('the desktop declares no tools yet')),
  });
  brain.start();
  return brain;
}
