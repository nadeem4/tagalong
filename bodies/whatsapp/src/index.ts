/**
 * Entry of the bundled bridge (dist/index.js). The brain starts it on Tagalong's own Node with
 * a stdin pipe: when the pipe closes the brain is gone, so the bridge exits too, even if the
 * brain was killed without cleanup. Logs go to stdout, where the brain's logger masks secrets.
 */
import { pathToFileURL } from 'node:url';
import type { BrainSocket } from '@tagalong/contract';
import { createBridge } from './bridge';
import { readConfig } from './config';

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

/** Starts the bridge, or says why not and exits 1. Returns null on a bad setup. */
export function main(
  env: NodeJS.ProcessEnv,
  exit: (code: number) => void,
  out: (line: string) => void,
): ReturnType<typeof createBridge> | null {
  let config;
  try {
    config = readConfig(env);
  } catch (e) {
    out((e as Error).message);
    exit(1);
    return null;
  }
  const bridge = createBridge({ config, openSocket: webSocket, log: out });
  // Only /webhook is public, but the tunnel the person sets up reaches us on loopback.
  bridge.webhook.listen(config.port, '127.0.0.1', () =>
    out(`whatsapp: listening on ${config.port}`),
  );
  void bridge.start();
  return bridge;
}

// Run only as the entry, not when a test imports main.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const bridge = main(process.env, (code) => process.exit(code), console.log);
  if (bridge) {
    const quit = (): void => {
      void bridge.stop();
      bridge.webhook.close();
      process.exit(0);
    };
    process.stdin.on('end', quit).on('close', quit).resume();
    process.on('SIGTERM', quit);
  }
}
