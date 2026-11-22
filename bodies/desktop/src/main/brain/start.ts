/**
 * Starts the desktop's brain client on a real websocket. It dials the address the brain
 * listens on (TAGALONG_BRAIN_ADDR, the same variable; launch.ts starts a local brain first
 * if none runs) and BrainClient keeps retrying while it is down. It declares the window and file body tools.
 */
import { homedir, hostname } from 'node:os';
import { BrainClient, dialOrder } from '@tagalong/contract';
import type { BrainClientOptions, BrainSocket, DialTarget } from '@tagalong/contract';
import type { CaptureExclusions } from '../../shared/settings';
import type { CaptureNotice } from '../../shared/ipc';
import type { Platform } from '../platform/index';
import { bodyTools } from './body-tools';
import type { LinkStore, PairedLink } from './link-store';
import { readLocalToken } from './launch';
import { pinnedSocket } from './pinned-socket';
import type { ReadingDeps } from './body-tools';
import type { FileDeps } from '../tools/files';

const DEFAULT_ADDR = '127.0.0.1:47321';
const SEARCH_EVERY_MS = 30_000;

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
  /** This install's body id (`readOrMakeBodyId`); the brain keeps one body per id. */
  bodyId: string;
  env?: NodeJS.ProcessEnv;
  /** Which brain this desktop is paired with, and the device token for a remote one. */
  link: Pick<LinkStore, 'paired' | 'token' | 'markGood' | 'addAddrs'>;
  /** Addresses of brains on the home network; asked only after every saved address has failed. */
  search: () => Promise<string[]>;
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
    search,
    openSocket,
    platform,
    exclusions,
    onCapture,
    openExternal,
    files,
    reading,
    ...handlers
  } = options;
  // A paired brain is dialed over wss by address in turn: a dial that fails (or shows another
  // certificate) moves on to the next, one that reaches the brain is dialed first next time.
  const cursor = { key: '', order: [] as string[], tried: 0, found: [] as string[], searchedAt: 0 };
  const restart = (key = cursor.key): void => {
    Object.assign(cursor, { key, order: [], tried: 0 });
  };
  const failed = (paired: PairedLink): void => {
    cursor.tried += 1;
    const now = Date.now();
    if (
      cursor.tried === dialOrder(paired, []).length &&
      now - cursor.searchedAt >= SEARCH_EVERY_MS
    ) {
      cursor.searchedAt = now;
      search().then(
        (addrs) => {
          cursor.found = addrs;
          cursor.order = [];
        },
        () => undefined,
      );
    }
    if (cursor.tried >= cursor.order.length) restart();
  };
  const dial = (): DialTarget & { fp?: string } => {
    const paired = link.paired();
    if (paired === null) return { scheme: 'ws', addr: env.TAGALONG_BRAIN_ADDR ?? DEFAULT_ADDR };
    const key = JSON.stringify([paired.addrs, paired.fp]);
    if (key !== cursor.key) {
      restart(key);
      cursor.found = [];
    }
    if (cursor.order.length === 0) cursor.order = dialOrder(paired, cursor.found);
    return { scheme: 'wss', addr: cursor.order[cursor.tried] ?? '', fp: paired.fp };
  };
  let reached = false;
  let stopping = false;
  const { tools, run } = bodyTools(platform, exclusions, onCapture, openExternal, files, reading);
  const brain = new BrainClient({
    ...handlers,
    onHello: (hello) => {
      if (hello.addrs !== undefined) link.addAddrs(hello.addrs);
      handlers.onHello?.(hello);
    },
    onStatus: (status) => {
      const paired = link.paired();
      if (paired !== null && status === 'online') {
        link.markGood(brain.addr);
        reached = true;
        restart();
        cursor.found = [];
      } else if (paired !== null && status === 'offline') {
        if (reached || stopping) reached = false;
        else failed(paired);
      }
      handlers.onStatus(status);
    },
    target: dial,
    // The PC's name is shown to the person, so two desktops can be told apart.
    body: { id: bodyId, kind: 'desktop', name: hostname() },
    // Read on every dial: a brain started after the desktop writes the file late, and the
    // client does not say hello without a token, so it dials again.
    token: () => (link.paired() === null ? readLocalToken(env, homedir()) : link.token()) ?? '',
    tools: () => tools,
    openSocket:
      openSocket ??
      ((url) => {
        const { fp } = dial();
        return fp === undefined ? webSocket(url) : pinnedSocket(url, fp);
      }),
    onUse: (tool, input) => run(tool, input),
  });
  const stop = brain.stop.bind(brain);
  brain.stop = () => {
    stopping = true;
    stop();
    stopping = false;
    restart();
  };
  brain.start();
  return brain;
}
