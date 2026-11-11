/**
 * Starts the desktop's brain client on a real websocket. It dials the address the brain
 * listens on (TAGALONG_BRAIN_ADDR, the same variable; launch.ts starts a local brain first
 * if none runs) and BrainClient keeps retrying while it is down. It declares the window and file body tools.
 */
import { BrainClient } from '@tagalong/contract';
import type { BrainClientOptions, BrainSocket } from '@tagalong/contract';
import type { CaptureExclusions } from '../../shared/settings';
import type { CaptureNotice } from '../../shared/ipc';
import type { Platform } from '../platform/index';
import { bodyTools } from './body-tools';
import type { ReadingDeps } from './body-tools';
import type { FileDeps } from '../tools/files';

const DEFAULT_ADDR = '127.0.0.1:47321';

type StartBrainOptions = Pick<
  BrainClientOptions,
  'onNotification' | 'onStatus' | 'onResync' | 'onHello'
> & {
  platform: Platform;
  exclusions: () => CaptureExclusions;
  onCapture: (notice: CaptureNotice) => void;
  /** Opens a page in the browser for the brain's open_url tool (the shell, in the app). */
  openExternal: (url: string) => Promise<void>;
  /** The folders Scout may use for files, and the Recycle Bin call for deletes. */
  files: FileDeps;
  /** How Scout reads the screen: detection, the language install and telling the brain. */
  reading: ReadingDeps;
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
  const {
    env = process.env,
    openSocket = webSocket,
    platform,
    exclusions,
    onCapture,
    openExternal,
    files,
    reading,
    ...handlers
  } = options;
  const { tools, run } = bodyTools(platform, exclusions, onCapture, openExternal, files, reading);
  const brain = new BrainClient({
    ...handlers,
    addr: env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR,
    body: { id: 'desktop', kind: 'desktop', name: 'Desktop' },
    tools: () => tools,
    openSocket,
    onUse: (tool, input) => run(tool, input),
  });
  brain.start();
  return brain;
}
