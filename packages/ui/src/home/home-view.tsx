import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { ActivityEntry, Expert, Pet, RoutineProposedParams } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import { PixelSprite } from '../office/pixel-sprite';
import { characterFor } from '../office/sprites/characters';
import { SETTINGS_CSS } from '../settings/settings-styles';
import { ActivityView } from './activity-view';
import { brainLabel, modelLabel } from './brain-label';
import { ConnectionsPanel } from './connections-panel';
import { ExpertsPanel } from './experts-panel';
import { HOME_CSS } from './home-styles';
import { RoutinesPanel } from './routines-panel';

export type HomePage =
  'overview' | 'scout' | 'experts' | 'routines' | 'connections' | 'activity' | 'settings';

const PAGES: readonly { id: HomePage; label: (name: string) => string }[] = [
  { id: 'overview', label: () => 'Overview' },
  { id: 'scout', label: (name) => name },
  { id: 'experts', label: () => 'Experts' },
  { id: 'routines', label: () => 'Routines' },
  { id: 'connections', label: () => 'Connections' },
  { id: 'activity', label: () => 'Activity' },
  { id: 'settings', label: () => 'Settings' },
];

export interface HomeProvider {
  id: string;
  label: string;
  needsKey?: boolean;
}

/** What Home needs from its host beyond the bridge: the companion and how it can think. */
export interface HomeHost {
  setup(): Promise<{
    companionId: string;
    /** `needsKey` marks a service that thinks on an API key, so the picker can say so. */
    providers: readonly HomeProvider[];
  }>;
  listModels(providerId: string): Promise<{ models: string[]; source: 'live' | 'fallback' }>;
  savePet(pet: Pet): Promise<Pet>;
}

export interface HomeViewProps {
  host: HomeHost;
  /** The host's settings form: keys, hotkey, sight, memory, the browser extension. */
  settings: ReactNode;
  /** The page to show; the host sets it when the tray or the bubble opens a page. */
  page?: HomePage;
  onPage?: (page: HomePage) => void;
  /** Scout's routine card, opened by its Edit button: Routines shows it in the form. */
  routineDraft?: RoutineProposedParams;
}

/**
 * Home: the one window for everything. The companion in the corner, and seven pages: an
 * overview, how the companion thinks, the experts it hands work to, what it does on its own,
 * the apps it can use, what happened, and the app's settings.
 */
export function HomeView({ host, settings, page: asked, onPage, routineDraft }: HomeViewProps) {
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

  const companion =
    pets.find((pet) => pet.id === setup?.companionId) ?? pets[0] ?? (undefined as Pet | undefined);
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
            {companion !== undefined && (
              <PixelSprite sprite={characterFor(companion).sprite} scale={3} />
            )}
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
        {page === 'overview' && <Overview companion={companion} setup={setup} onGo={go} />}
        {page === 'scout' && companion !== undefined && setup !== null && (
          <ScoutPanel
            key={companion.id}
            pet={companion}
            providers={setup.providers}
            host={host}
            onOpenSettings={() => go('settings')}
            onSaved={(saved) =>
              setPets((current) => current.map((pet) => (pet.id === saved.id ? saved : pet)))
            }
          />
        )}
        {page === 'experts' && <ExpertsPanel />}
        {page === 'routines' && (
          <RoutinesPanel draft={routineDraft} onOpenActivity={() => go('activity')} />
        )}
        {page === 'connections' && <ConnectionsPanel />}
        {page === 'activity' && <ActivityView pets={pets} />}
        {page === 'settings' && settings}
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
  onGo,
}: {
  companion: Pet | undefined;
  setup: Awaited<ReturnType<HomeHost['setup']>> | null;
  onGo: (page: HomePage) => void;
}) {
  const bridge = useHostBridge();
  const [experts, setExperts] = useState<Expert[] | null>(null);
  const [recent, setRecent] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    void bridge.listExperts?.().then(setExperts);
    void bridge.listActivity?.({ limit: 3 }).then((page) => setRecent(page.entries));
  }, [bridge]);

  const name = companion?.name ?? 'Scout';
  return (
    <>
      <h1 className="home-title">Overview</h1>
      <div className="home-cards">
        <section className="home-card" aria-label={name}>
          <h2 className="home-card__label">{name.toUpperCase()}</h2>
          <p className="home-card__lead">
            <span className="home-dot" aria-hidden="true" /> Ready
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
          <button type="button" className="tg-btn-quiet" onClick={() => onGo('scout')}>
            Change how {name} thinks
          </button>
        </section>
        <section className="home-card" aria-label="Experts">
          <h2 className="home-card__label">EXPERTS</h2>
          {experts !== null && experts.length === 0 && (
            <p>No experts yet. {name} answers by itself until you add one.</p>
          )}
          {(experts ?? []).map((expert) => (
            <p key={expert.id} className="home-card__row">
              <strong>{expert.name}</strong>
              <span>
                {expert.enabled ? 'Ready' : 'Off'} ·{' '}
                {expert.connection.canEdit ? 'can edit' : 'reads only'}
              </span>
            </p>
          ))}
          <button type="button" className="tg-btn-quiet" onClick={() => onGo('experts')}>
            Manage experts
          </button>
        </section>
      </div>
      <section className="home-card" aria-label="Recent">
        <h2 className="home-card__label">RECENT</h2>
        {recent.length === 0 && <p>Nothing yet. Press the key and ask {name} something.</p>}
        {recent.map((entry) => (
          <p key={entry.id} className="home-card__row">
            <span>
              <strong>{entry.kind === 'expert' ? (entry.expertName ?? 'Expert') : name}</strong>
              {entry.kind === 'connector'
                ? ` · ${entry.access === 'read' ? 'read' : 'changed'} ${entry.app ?? 'an app'}`
                : entry.text !== undefined
                  ? ` · ${entry.text}`
                  : ''}
            </span>
            <span>{STATE_WORDS[entry.state]}</span>
          </p>
        ))}
        <button type="button" className="tg-btn-quiet" onClick={() => onGo('activity')}>
          See all activity
        </button>
      </section>
    </>
  );
}

const STATE_WORDS: Record<ActivityEntry['state'], string> = {
  running: 'Working',
  done: 'Done',
  error: 'Failed',
  stopped: 'Stopped',
};

/** How the companion thinks: the provider and the model. Its role is always the Companion. */
function ScoutPanel({
  pet,
  providers,
  host,
  onSaved,
  onOpenSettings,
}: {
  pet: Pet;
  providers: readonly HomeProvider[];
  host: HomeHost;
  onSaved: (pet: Pet) => void;
  onOpenSettings: () => void;
}) {
  const [providerId, setProviderId] = useState(pet.providerId);
  const [model, setModel] = useState(pet.model);
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let current = true;
    host
      .listModels(providerId)
      .then((list) => {
        if (!current) return;
        setModels(list.models);
        // A provider change starts on that provider's first model, unless the pet's fits.
        setModel((chosen) => (list.models.includes(chosen) ? chosen : (list.models[0] ?? chosen)));
      })
      .catch((error: unknown) => {
        if (!current) return;
        // The picker keeps the model it has rather than going blank.
        setModels([]);
        setStatus({
          text: `The model list could not be read: ${error instanceof Error ? error.message : String(error)}`,
          error: true,
        });
      });
    return () => {
      current = false;
    };
  }, [host, providerId]);

  const save = async (): Promise<void> => {
    try {
      const { visionModel: _vision, watchModel: _watch, ...rest } = pet;
      const changed = providerId !== pet.providerId;
      const saved = await host.savePet({
        ...(changed ? rest : pet),
        providerId,
        model,
      });
      onSaved(saved);
      setStatus({
        text: `Saved. ${saved.name} thinks this way from the next question.`,
        error: false,
      });
    } catch (error) {
      setStatus({
        text: `Not saved. ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      });
    }
  };

  return (
    <section className="tg-panel home-controls" aria-label={`How ${pet.name} thinks`}>
      <h1 className="home-title">{pet.name}</h1>
      <p className="tg-note">
        {pet.name} is your companion. When you ask, it looks at what you are doing, writes a brief
        and hands it to the right expert. This is the brain it does that with.
      </p>
      <label>
        <span>Thinks with</span>
        <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.needsKey === undefined
                ? provider.label
                : `${provider.label} (${provider.needsKey ? 'API key' : 'no key'})`}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Model</span>
        <select value={model} onChange={(event) => setModel(event.target.value)}>
          {(models.includes(model) ? models : [model, ...models]).map((id) => (
            <option key={id} value={id}>
              {providerId === 'claude-code' && id === 'haiku'
                ? 'Haiku (quick, recommended)'
                : modelLabel(providerId, id)}
            </option>
          ))}
        </select>
      </label>
      <p className="tg-note">
        A service that needs a key uses the one stored in{' '}
        <button type="button" className="home-link" onClick={onOpenSettings}>
          Settings, under Advanced
        </button>
        .
      </p>
      <div className="tg-footer home-controls__footer">
        <button type="button" className="tg-btn" onClick={() => void save()}>
          Save
        </button>
        {status !== null && (
          <p
            className={status.error ? 'tg-error' : undefined}
            role={status.error ? 'alert' : 'status'}
          >
            {status.text}
          </p>
        )}
      </div>
    </section>
  );
}
