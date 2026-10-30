/**
 * The browser body: one BrainClient for this browser, with the tools it offers. Everything it
 * touches (storage, tabs, sockets) is passed in, so a test can run it without a real Chrome.
 * The service worker only wires the real pieces in and forwards events.
 */
import { BrainClient, type BrainSocket, type BrainStatus } from '@tagalong/contract';
import { browserName, detectBrowser, loadBodyId } from './identity';
import type { PageApi, PictureApi, SearchApi, StorageArea, TabsApi } from './layer/api';
import { createTabReporter, downloadEvent } from './events';
import { readSettings } from './settings';
import { toolset } from './tools/registry';
import type { PermissionBroker } from './permissions';
import { browserSearchTool } from './tools/browser-search';
import { pagePartsTool } from './tools/page-parts';
import { tabsTool } from './tools/tabs';

const SEQ_KEY = 'lastSeq';
const KEEPALIVE = { everyMs: 20_000, tool: 'spend_today' };

/** What the popup shows: the link and who this body is. */
export type WorkerStatus = { status: BrainStatus; id: string; name: string };

export interface BodyDeps {
  /** Settings and the body id. */
  storage: StorageArea;
  /** Survives a worker restart but not a browser restart, which is what last_seq needs. */
  session: StorageArea;
  brands: readonly string[];
  userAgent: string;
  tabs: TabsApi;
  page: PageApi;
  picture: PictureApi;
  search: SearchApi;
  broker: PermissionBroker;
  /** Makes the id's 4 random chars; tests pin it. */
  random?: () => string;
  openSocket: (url: string) => BrainSocket;
}

export interface BrowserBody {
  /** Dials the brain; does nothing more while a client is already connecting or online. */
  start(): Promise<void>;
  /** Closes the link and ends the keepalive; start() dials again. */
  stop(): void;
  /** Drops the link and dials again with the saved address and name. */
  restart(): Promise<void>;
  info(): WorkerStatus;
  /** The tab in front changed; sent to the brain as a throttled `tab` fact while online. */
  tabChanged(tab: { title: string; url: string }): void;
  /** A download changed state; only finished or failed ones are sent, as a `download` fact. */
  downloadChanged(item: { filename: string; state: string }): void;
}

export function createBody(deps: BodyDeps): BrowserBody {
  let client: BrainClient | null = null;
  let starting: Promise<void> | null = null;
  let id = '';
  let name = '';
  // Made once so the throttle survives a restart; a missing or offline client drops the fact.
  const reportTab = createTabReporter({
    send: (event, data) => client?.event(event, data) ?? false,
    now: () => Date.now(),
  });

  async function build(): Promise<void> {
    const kind = detectBrowser(deps.brands, deps.userAgent);
    // Once per start: two concurrent callers would otherwise each make an id.
    id = await loadBodyId(deps.storage, kind, deps.random);
    const settings = await readSettings(deps.storage);
    name = settings.name ?? browserName(kind);
    const set = toolset([
      tabsTool({
        tabs: deps.tabs,
        page: deps.page,
        picture: deps.picture,
        needs: deps.broker,
        bodyName: name,
      }),
      pagePartsTool({ tabs: deps.tabs, page: deps.page, needs: deps.broker, bodyName: name }),
      browserSearchTool({ search: deps.search, needs: deps.broker, bodyName: name }),
    ]);
    client = new BrainClient({
      addr: settings.addr,
      body: { id, kind: 'browser', name },
      seqStore: {
        load: async () => {
          const seq = await deps.session.get(SEQ_KEY);
          return typeof seq === 'number' ? seq : null;
        },
        save: (seq) => void deps.session.set(SEQ_KEY, seq).catch(() => undefined),
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
    stop() {
      client?.stop();
    },
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
    tabChanged: reportTab,
    downloadChanged(item) {
      const fact = downloadEvent(item);
      if (fact) client?.event('download', fact);
    },
  };
}
