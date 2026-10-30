/**
 * The browser body: one BrainClient for this browser, with the tools it offers. Everything it
 * touches (storage, tabs, sockets) is passed in, so a test can run it without a real Chrome.
 * The service worker only wires the real pieces in and forwards events.
 */
import { BrainClient, type BrainSocket, type BrainStatus } from '@tagalong/contract';
import { browserName, detectBrowser, loadBodyId } from './identity';
import type { PageApi, StorageArea, TabsApi } from './layer/api';
import { readSettings } from './settings';
import type { WorkerStatus } from './popup/model';
import { toolset } from './tools/registry';
import { tabsTool, type Needs } from './tools/tabs';

const SEQ_KEY = 'lastSeq';
const KEEPALIVE = { everyMs: 20_000, tool: 'spend_today' };

export interface BodyDeps {
  local: StorageArea;
  /** Survives a worker restart but not a browser restart, which is what last_seq needs. */
  session: StorageArea;
  brands: readonly string[];
  userAgent: string;
  tabs: TabsApi;
  page: PageApi;
  needs: Needs;
  openSocket: (url: string) => BrainSocket;
}

export interface BrowserBody {
  /** Dials the brain; does nothing more while a client is already connecting or online. */
  start(): Promise<void>;
  /** Drops the link and dials again with the saved address and name. */
  restart(): Promise<void>;
  info(): WorkerStatus;
}

export function createBody(deps: BodyDeps): BrowserBody {
  let client: BrainClient | null = null;
  let starting: Promise<void> | null = null;
  let id = '';
  let name = '';

  async function build(): Promise<void> {
    const kind = detectBrowser(deps.brands, deps.userAgent);
    // Once per start: two concurrent callers would otherwise each make an id.
    id = await loadBodyId(deps.local, kind);
    const settings = await readSettings(deps.local);
    name = settings.name ?? browserName(kind);
    const set = toolset([tabsTool({ ...deps, bodyName: name })]);
    client = new BrainClient({
      addr: settings.addr,
      body: { id, kind: 'browser', name },
      seqStore: {
        load: async () => {
          const seq = await deps.session.get(SEQ_KEY);
          return typeof seq === 'number' ? seq : null;
        },
        save: (seq) => void deps.session.set(SEQ_KEY, seq),
      },
      keepalive: KEEPALIVE,
      tools: () => set.tools(),
      openSocket: deps.openSocket,
      onUse: (tool, input) => set.run(tool, input),
      // The browser shows nothing from the brain yet, so these are heard and dropped.
      onNotification: () => undefined,
      onStatus: () => undefined,
      onResync: () => undefined,
    });
    client.start();
  }

  async function start(): Promise<void> {
    if (client) {
      client.start();
      return;
    }
    starting ??= build().finally(() => {
      starting = null;
    });
    await starting;
  }

  return {
    start,
    async restart() {
      await starting;
      client?.stop();
      client = null;
      await start();
    },
    info() {
      const status: BrainStatus = client?.link ?? 'offline';
      return { status, id, name };
    },
  };
}
