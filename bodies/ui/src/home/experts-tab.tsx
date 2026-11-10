/**
 * The Experts tab on Home's Connections page: the installed experts (the "For long jobs" group)
 * and the registry's experts to add. An Official expert adds with the brain's own Allow card; a
 * community one goes through the check card first. Contains ExpertsTab.
 */
import { useState } from 'react';
import type { SetupChoice, SetupOverview } from '../shapes';
import { Button } from '../controls/button';
import { CheckCard } from './check-card';
import { ExpertsGroup, stageWords } from './experts-group';

export function ExpertsTab({
  setup,
  asking,
  failedName,
  onAct,
  onAdd,
  onAddAnyway,
}: {
  setup: SetupOverview;
  asking: ReadonlySet<string>;
  /** Display name of the expert whose install did not finish, if one did not. */
  failedName: string | null;
  onAct: (id: string) => void;
  onAdd: (id: string) => void;
  onAddAnyway: (id: string) => void;
}) {
  const [checking, setChecking] = useState<string | null>(null);
  const { browseExperts: items, progress } = setup;

  const row = (item: SetupChoice) => {
    const working = progress?.expert === item.id || asking.has(item.id);
    return (
      <li key={item.id}>
        <div className="home-conn">
          <div className="home-conn__head">
            <span className="home-entry__body">
              <span className="home-entry__title" title={item.name}>
                {item.name}{' '}
                {item.official ? (
                  <span className="tg-chip conn-tag conn-tag--official">Official</span>
                ) : (
                  <span className="tg-chip conn-tag">Community</span>
                )}
              </span>
              <span className="home-entry__preview" title={item.description}>
                {item.description}
              </span>
            </span>
            {item.official ? (
              <Button
                variant="secondary"
                aria-label={`Add ${item.name}`}
                disabled={working}
                onClick={() => onAdd(item.id)}
              >
                Add
              </Button>
            ) : (
              <Button
                variant="secondary"
                aria-label={`Connect ${item.name}`}
                disabled={working}
                onClick={() => setChecking(item.id)}
              >
                Connect
              </Button>
            )}
          </div>
          {checking === item.id && (
            <CheckCard
              row={{
                name: item.name,
                publisher: 'Unknown',
                runs: 'pc',
                licence: 'Unknown',
                repo: '',
              }}
              busy={working}
              onBack={() => setChecking(null)}
              onConnect={() => {
                setChecking(null);
                onAddAnyway(item.id);
              }}
            />
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      {failedName !== null && (
        <p className="tg-error" role="alert">
          Setting up {failedName} didn’t finish. Try again.
        </p>
      )}
      <ExpertsGroup experts={setup.experts} progress={progress} asking={asking} onAct={onAct} />
      {items.length > 0 && (
        <section className="home-card home-conns" aria-label="Browse experts">
          <h2 className="home-card__label">BROWSE EXPERTS</h2>
          {items.some((item) => progress?.expert === item.id) && progress !== null && (
            <p className="tg-note" role="status">
              {stageWords(progress)}
            </p>
          )}
          <details>
            <summary className="tg-note">Browse and add</summary>
            <ul className="home-list home-conns__list">{items.map(row)}</ul>
          </details>
        </section>
      )}
    </>
  );
}
