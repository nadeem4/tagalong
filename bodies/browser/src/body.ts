/**
 * The browser body: one BrainClient for this browser, with the tools it offers. Everything it
 * touches (storage, tabs, sockets) is passed in, so a test can run it without a real Chrome.
 * The service worker only wires the real pieces in and forwards events.
 */
import {
  BrainClient,
  BrainOffline,
  type BrainSocket,
  type BrainStatus,
  type HeardParams,
  type SayParams,
  type VoiceParams,
} from '@tagalong/contract';
import { browserName, detectBrowser, loadBodyId } from './identity';
import type { ActionsApi, PageApi, PictureApi, SearchApi, StorageArea, TabsApi } from './layer/api';
import { createTabReporter, downloadEvent } from './events';
import { readSettings } from './settings';
import { toolset } from './tools/registry';
import type { PermissionBroker } from './permissions';
import { browserSearchTool } from './tools/browser-search';
import { pagePartsTool } from './tools/page-parts';
import { tabActionsTool } from './tools/tab-actions';
import { tabsTool } from './tools/tabs';
import type { MicControl } from './voice/mic-control';
import { createVoiceSession, type VoiceView } from './voice/voice-session';

const SEQ_KEY = 'lastSeq';
/** How long an ask waits for the link before it is dropped, and how often it looks. */
const SAY_WAIT_MS = 5_000;
const SAY_POLL_MS = 100;
const KEEPALIVE = { everyMs: 20_000, tool: 'spend_today' };

/** What the popup shows: the link and who this body is. */
export type WorkerStatus = { status: BrainStatus; id: string; name: string; voice: VoiceView };

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
  actions: ActionsApi;
  broker: PermissionBroker;
  /** The offscreen page that owns the microphone while the person is talking. */
  mic: MicControl;
  /** The popup's voice view changed; the worker passes it on to an open popup. */
  onVoiceView: (view: VoiceView) => void;
  /** Makes the id's 4 random chars; tests pin it. */
  random?: () => string;
  openSocket: (url: string) => BrainSocket;
}

interface BrowserBody {
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
  /**
   * The person asked Scout something from the right-click menu or the address bar. The answer
   * shows on a displaying body. It starts the body if a woken worker has none yet and waits up to
   * 5 s for the link; if the brain is still down the ask is dropped, and the popup's status line
   * is where the person sees that.
   */
  say(text: string, context?: { url: string; title: string }): Promise<void>;
  /** The popup's mic button: listen, forward frames, and send what was heard as a spoken ask. */
  voiceStart(): Promise<void>;
  voiceStop(): void;
  voiceFrame(pcm: Int16Array): void;
  /** The mic page failed or went away; ends an active session with this plain line. */
  voiceEnd(reason: string): void;
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

  // The browser shows no answers, so voice is listen only: the spoken ask goes to the brain and
  // the reply is shown and spoken by the displaying body (the desktop).
  const voice = createVoiceSession({
    client: {
      listen: (mode) => (client ? client.listen(mode) : Promise.reject(new BrainOffline())),
      mic: (pcm) => client?.mic(pcm) ?? false,
      unlisten: () => client?.unlisten(),
    },
    mic: deps.mic,
    say: (text) => ask({ text, spoken: true }),
    onChange: deps.onVoiceView,
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
      tabActionsTool({
        actions: deps.actions,
        tabs: deps.tabs,
        needs: deps.broker,
        bodyName: name,
      }),
    ]);
    client = new BrainClient({
      addr: settings.addr,
      // display: false because the browser shows no answers; the brain routes them elsewhere.
      body: { id, kind: 'browser', name, display: false },
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
      // Only the ears' events matter here; the browser shows nothing else from the brain.
      onNotification: (method, params) => {
        if (method === 'heard')
          voice.onHeard((params as HeardParams).event, (params as HeardParams).text);
        if (method === 'voice')
          voice.onVoice((params as VoiceParams).status, (params as VoiceParams).message);
      },
      // A listen does not survive the link: the brain stops hearing a body that disconnects.
      onStatus: (status) => {
        if (status !== 'online') voice.end("Scout's brain went away.");
      },
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

  async function ask(params: SayParams): Promise<void> {
    // A woken worker has no client yet and a fresh one is still connecting, so wait for it.
    await start();
    const deadline = Date.now() + SAY_WAIT_MS;
    while (client?.link !== 'online' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SAY_POLL_MS));
    }
    try {
      await client?.say(params);
    } catch (error) {
      if (!(error instanceof BrainOffline)) throw error;
    }
  }

  return {
    start,
    stop() {
      client?.stop();
    },
    async restart() {
      voice.end('Scout reconnected, so it stopped listening.');
      await starting;
      client?.stop();
      client = null;
      await start();
    },
    info() {
      const status: BrainStatus = client?.link ?? 'offline';
      return { status, id, name, voice: voice.view() };
    },
    tabChanged: reportTab,
    downloadChanged(item) {
      const fact = downloadEvent(item);
      if (fact) client?.event('download', fact);
    },
    say: (text, context) => ask(context === undefined ? { text } : { text, context }),
    voiceStart: () => voice.start(),
    voiceStop: () => voice.stop(),
    voiceFrame: (pcm) => voice.frame(pcm),
    voiceEnd: (reason) => voice.end(reason),
  };
}
