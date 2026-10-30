/**
 * Home: the one window for the companion and the app. Scout in the corner and six pages
 * (overview, jobs, connections, approvals, what Scout remembers, settings), each fed by the
 * Python brain. Contains HomeView, HomeHost, HomeProvider and HomePage. Rendered by the
 * desktop `home` page.
 */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Pet } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import { BeanClip } from '../theme/bean-clip';
import type { BeanClipData } from '../theme/bean-clip';
import { SETTINGS_CSS } from '../settings/settings-styles';
import { ApprovalsView } from './approvals-view';
import { brainLabel } from './brain-label';
import { ConnectionsPanel } from './connections-panel';
import { HOME_CSS } from './home-styles';
import { MemoryView } from './memory-view';
import { JobsPanel } from './jobs-panel';
import { PermissionsPanel } from './permissions-panel';
import { SpendCard } from './spend-card';
import { WhereThingsRun } from './where-things-run';

export type HomePage = 'overview' | 'jobs' | 'connections' | 'approvals' | 'memory' | 'settings';

const PAGES: readonly { id: HomePage; label: (name: string) => string }[] = [
  { id: 'overview', label: () => 'Overview' },
  { id: 'jobs', label: () => 'Jobs' },
  { id: 'connections', label: () => 'Connections' },
  { id: 'approvals', label: () => 'Approvals' },
  { id: 'memory', label: (name) => `What ${name} remembers` },
  { id: 'settings', label: () => 'Settings' },
];

export interface HomeProvider {
  id: string;
  label: string;
  needsKey?: boolean;
}

/** What Home needs from its host beyond the bridge: how the companion can think. */
export interface HomeHost {
  setup(): Promise<{
    /** `needsKey` marks a service that thinks on an API key, so the picker can say so. */
    providers: readonly HomeProvider[];
  }>;
  /**
   * Whether the companion can work right now, in a few words: "Ready", or what stops it
   * (signed out, no key, sight paused). Without it the overview says Ready.
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
 * Home: the one window for everything. The companion in the corner, and six pages: an
 * overview, the jobs it handed to Claude Code, the apps it can use, what it may do alone and
 * what you approved, what it remembers, and the app's settings.
 */
export function HomeView({ host, scout, settings, page: asked, onPage }: HomeViewProps) {
  const bridge = useHostBridge();
  const [page, setPage] = useState<HomePage>(asked ?? 'overview');
  const [pets, setPets] = useState<Pet[]>([]);
  const [setup, setSetup] = useState<Awaited<ReturnType<HomeHost['setup']>> | null>(null);

  const [lastAsked, setLastAsked] = useState(asked);
  if (asked !== lastAsked) {
    setLastAsked(asked);
    if (asked !== undefined) setPage(asked);
  }

  useEffect(() => {
    void Promise.all([bridge.listPets(), host.setup()]).then(([listed, loaded]) => {
      setPets(listed);
      setSetup(loaded);
    });
  }, [bridge, host]);

  const companion = pets[0] as Pet | undefined;
  const name = companion?.name ?? 'Scout';
  const go = (next: HomePage): void => {
    setPage(next);
    onPage?.(next);
  };

  return (
    <div className="home">
      <style>{SETTINGS_CSS}</style>
      <style>{HOME_CSS}</style>
      <nav aria-label="Tagalong" className="home-nav">
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
          </button>
        ))}
      </nav>
      <main className="home-main">
        {page === 'overview' && <Overview companion={companion} setup={setup} host={host} />}
        {page === 'jobs' && <JobsPanel />}
        {page === 'connections' && <ConnectionsPanel />}
        {page === 'approvals' && <ApprovalsView />}
        {page === 'memory' && <MemoryView name={name} />}
        {page === 'settings' && (
          <>
            {settings}
            <PermissionsPanel />
          </>
        )}
      </main>
    </div>
  );
}

function providerLabel(
  setup: Awaited<ReturnType<HomeHost['setup']>> | null,
  providerId: string,
): string {
  return setup?.providers.find((p) => p.id === providerId)?.label ?? providerId;
}

/** "Your Claude sign-in" reads "your Claude sign-in" mid-sentence. */
function lowerYour(label: string): string {
  return label.startsWith('Your ') ? `y${label.slice(1)}` : label;
}

function Overview({
  companion,
  setup,
  host,
}: {
  companion: Pet | undefined;
  setup: Awaited<ReturnType<HomeHost['setup']>> | null;
  host: HomeHost;
}) {
  const [status, setStatus] = useState<{ text: string; ok: boolean }>({ text: 'Ready', ok: true });

  useEffect(() => {
    void host
      .status?.()
      .then(setStatus)
      .catch(() => undefined);
  }, [host, companion]);

  const name = companion?.name ?? 'Scout';
  return (
    <>
      <h1 className="home-title">Overview</h1>
      <div className="home-cards">
        <section className="home-card" aria-label={name}>
          <h2 className="home-card__label">{name.toUpperCase()}</h2>
          <p className="home-card__lead">
            <span
              className={status.ok ? 'home-dot' : 'home-dot home-dot--warn'}
              aria-hidden="true"
            />{' '}
            {status.text}
          </p>
          {companion !== undefined && (
            <p>
              Thinks with{' '}
              {brainLabel(
                lowerYour(providerLabel(setup, companion.providerId)),
                companion.providerId,
                companion.model,
              )}
            </p>
          )}
          <p>Looks at your screen when you ask it something. Never at its blind spots.</p>
        </section>
      </div>
      <WhereThingsRun />
      <SpendCard />
    </>
  );
}
