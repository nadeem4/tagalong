/**
 * Home: the one window for the companion and the app. Scout in the corner and seven pages
 * (overview, tasks, connections, places, approvals, what Scout remembers, settings), each fed by the
 * Python brain. Contains HomeView, HomeHost and HomePage. Rendered by the
 * desktop `home` page.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Pet } from '../shapes';
import { useHostBridge } from '../host-bridge';
import { BeanClip } from '../theme/bean-clip';
import type { BeanClipData } from '../theme/bean-clip';
import { Button } from '../controls/button';
import { CONTROLS_CSS } from '../controls/controls-styles';
import { SETTINGS_CSS } from '../settings/settings-styles';
import { ApprovalsView } from './approvals-view';
import { ConnectionsPanel } from './connections-panel';
import { CONNECTIONS_CSS } from './connections-styles';
import { HOME_CSS } from './home-styles';
import { MemoryView } from './memory-view';
import { TasksView } from './tasks-view';
import { PlacesView } from './places-view';
import { PermissionsPanel } from './permissions-panel';
import { SpendCard } from './spend-card';
import { BrainCard } from './brain-card';
import { UpdateBanner } from './update-banner';
import { LINK, WhereThingsRun } from './where-things-run';

export type HomePage = 'overview' | 'tasks' | 'connections' | 'places' | 'approvals' | 'memory' | 'settings';

const PAGES: readonly { id: HomePage; label: (name: string) => string }[] = [
  { id: 'overview', label: () => 'Overview' },
  { id: 'tasks', label: () => 'Tasks' },
  { id: 'connections', label: () => 'Connections' },
  { id: 'places', label: () => 'Places' },
  { id: 'approvals', label: () => 'Approvals' },
  { id: 'memory', label: (name) => `What ${name} remembers` },
  { id: 'settings', label: () => 'Settings' },
];

/** What Home needs from its host beyond the bridge. */
export interface HomeHost {
  /**
   * Whether the companion can work right now, in a few words: "Ready", or what stops it
   * (sight paused). Without it the overview says Ready.
   */
  status?(): Promise<{ text: string; ok: boolean }>;
}

export interface HomeViewProps {
  host: HomeHost;
  /** Bean's idle strip, drawn still in the nav tile. */
  scout: BeanClipData;
  /** The host's settings form: keys, hotkey, sight, memory. */
  settings: ReactNode;
  /** The page to show; the host sets it when the tray or the bubble opens a page. */
  page?: HomePage;
  onPage?: (page: HomePage) => void;
}

/**
 * Home: the one window for everything. The companion in the corner, and seven pages: an
 * overview, its tasks (jobs, held mail, timers), the apps it can use, the places you can talk to it, what it may do alone and
 * what you approved, what it remembers, and the app's settings.
 */
export function HomeView({ host, scout, settings, page: asked, onPage }: HomeViewProps) {
  const bridge = useHostBridge();
  const [page, setPage] = useState<HomePage>(asked ?? 'overview');
  const [pets, setPets] = useState<Pet[]>([]);

  const [lastAsked, setLastAsked] = useState(asked);
  if (asked !== lastAsked) {
    setLastAsked(asked);
    if (asked !== undefined) setPage(asked);
  }

  useEffect(() => {
    void bridge.listPets().then(setPets);
  }, [bridge]);

  const companion = pets[0] as Pet | undefined;
  const name = companion?.name ?? 'Scout';
  const go = (next: HomePage): void => {
    setPage(next);
    onPage?.(next);
  };

  return (
    <div className="home">
      <style>{CONTROLS_CSS}</style>
      <style>{SETTINGS_CSS}</style>
      <style>{HOME_CSS}</style>
      <style>{CONNECTIONS_CSS}</style>
      <nav aria-label="Tagalong" className="home-nav on-navy">
        <div className="home-nav__who">
          <span className="home-nav__tile">
            {/* Larger than the tile, which crops it: Bean fills about two thirds of a frame. */}
            {companion !== undefined && <BeanClip clip={scout} still size={76} name="idle" />}
          </span>
          <span>
            <strong>{name}</strong>
            <small>Your companion</small>
          </span>
        </div>
        {PAGES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="home-nav__item"
            aria-current={page === item.id ? 'page' : undefined}
            onClick={() => go(item.id)}
          >
            {item.label(name)}
            {(item.id === 'tasks' || item.id === 'places') && (
              <span className="home-nav__badge" aria-hidden="true">
                New
              </span>
            )}
          </button>
        ))}
      </nav>
      <main className="home-main">
        <div className="home-page">
          {/* Overview shows the same prompt inside the brain card, so it skips the banner. */}
          {page !== 'overview' && <UpdateBanner />}
          {page === 'overview' && <Overview companion={companion} host={host} />}
          {page === 'tasks' && <TasksView />}
          {page === 'connections' && <ConnectionsPanel />}
          {page === 'places' && <PlacesView />}
          {page === 'approvals' && <ApprovalsView />}
          {page === 'memory' && <MemoryView name={name} />}
          {page === 'settings' && (
            <>
              {settings}
              <PermissionsPanel />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Overview({ companion, host }: { companion: Pet | undefined; host: HomeHost }) {
  const [status, setStatus] = useState<{ text: string; ok: boolean }>({ text: 'Ready', ok: true });

  const bridge = useHostBridge();

  useEffect(() => {
    // The brain link comes first: with no brain, "Ready" would be a lie. Read again on
    // every link change so the card follows an outage and the return.
    // Only the newest read may write: a slow reply must not undo a later "Brain: Offline".
    let latest = 0;
    const read = () => {
      const mine = ++latest;
      void bridge.brainLink().then(
        (link) => {
          if (mine !== latest) return;
          if (link.status !== 'online') {
            setStatus({ text: `Brain: ${LINK[link.status].words}`, ok: false });
            return;
          }
          void host.status?.().then(
            (next) => {
              if (mine === latest) setStatus(next);
            },
            () => undefined,
          );
          if (host.status === undefined) setStatus({ text: 'Ready', ok: true });
        },
        () => undefined,
      );
    };
    read();
    const stop = bridge.onBrainChanged((what) => {
      if (what === 'link') read();
    });
    return () => {
      latest = Infinity; // reads still in flight belong to a closed effect
      stop();
    };
  }, [bridge, host, companion]);

  const name = companion?.name ?? 'Scout';
  return (
    <>
      <div className="home-head">
        <h1 className="home-title">Overview</h1>
        <p>Everything {name} is doing for you.</p>
      </div>
      <div className="home-cards">
        <section className="home-card" aria-label={name}>
          <h2 className="home-card__label">{name}</h2>
          <p className="home-card__lead">
            <span
              className={status.ok ? 'home-dot' : 'home-dot home-dot--warn'}
              aria-hidden="true"
            />{' '}
            {status.text}
          </p>
          <p>Looks at your screen when you ask it something. Never at its blind spots.</p>
          <Button variant="secondary" onClick={() => void bridge.openWalkthrough(1)}>
            Show the tour again
          </Button>
        </section>
      </div>
      <BrainCard />
      <WhereThingsRun />
      <SpendCard />
    </>
  );
}
