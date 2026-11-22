/**
 * Starts the desktop's brain client on a real websocket. It dials the address the brain
 * listens on (TAGALONG_BRAIN_ADDR, the same variable; launch.ts starts a local brain first
 * if none runs) and BrainClient keeps retrying while it is down. It declares the window and file body tools.
 */
import { homedir, hostname } from 'node:os';
import { BrainClient, dialOrder } from '@tagalong/contract';
import type { BrainClientOptions, BrainSocket } from '@tagalong/contract';
import type { CaptureExclusions } from '../../shared/settings';
import type { CaptureNotice } from '../../shared/ipc';
import type { Platform } from '../platform/index';
import { bodyTools } from './body-tools';
import type { LinkStore } from './link-store';
import { readLocalToken } from './launch';
import { pinnedSocket } from './pinned-socket';
import type { ReadingDeps } from './body-tools';
import type { FileDeps } from '../tools/files';

const DEFAULT_ADDR = '127.0.0.1:47321';

type StartBrainOptions = Pick<
  BrainClientOptions,
  'onNotification' | 'onStatus' | 'onResync' | 'onHello' | 'retryMs'
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
  /** This install's body id (`readOrMakeBodyId`); the brain keeps one body per id. */
  bodyId: string;
  env?: NodeJS.ProcessEnv;
  /** Which brain this desktop is paired with, and the device token for a remote one. */
  link: Pick<LinkStore, 'get' | 'token' | 'markGood'>;
  /** Addresses of brains seen on the home network, tried after the saved ones. */
  found: () => string[];
  /** Tests pass a fake; the app uses the global WebSocket, or the pinned socket for a remote brain. */
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
    bodyId,
    env = process.env,
    link,
    found,
    openSocket,
    platform,
    exclusions,
    onCapture,
    openExternal,
    files,
    reading,
    ...handlers
  } = options;
  const remote = () => link.get().mode === 'remote';
  // A dial that fails (or a certificate that differs) moves on to the next address; one that
  // reaches the brain is remembered first. Nothing here ever falls back from wss to ws.
  let tried = 0;
  const nextAddr = (): string => {
    const order = dialOrder(link.get(), found(), []);
    return order[tried++ % order.length] ?? '';
  };
  const { tools, run } = bodyTools(platform, exclusions, onCapture, openExternal, files, reading);
  const brain = new BrainClient({
    ...handlers,
    onStatus: (status) => {
      if (status === 'online' && remote()) {
        link.markGood(brain.addr);
        tried = 0;
      }
      handlers.onStatus(status);
    },
    addr: () => (remote() ? nextAddr() : (env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR)),
    scheme: () => (remote() ? 'wss' : 'ws'),
    // The PC's name is shown to the person, so two desktops can be told apart.
    body: { id: bodyId, kind: 'desktop', name: hostname() },
    // Read on every dial: a brain started after the desktop writes the file late, and the
    // client does not say hello without a token, so it dials again.
    token: () => (remote() ? link.token() : readLocalToken(env, homedir())) ?? '',
    tools: () => tools,
    openSocket:
      openSocket ??
      ((url) => {
        const { fp } = link.get();
        return remote() && fp !== undefined ? pinnedSocket(url, fp) : webSocket(url);
      }),
    onUse: (tool, input) => run(tool, input),
  });
  brain.start();
  return brain;
}
