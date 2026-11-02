/**
 * "Browse and add" on Home's Connections page: what the registries list that is not set up
 * yet, one row each with an Add button. Used for experts and for apps. Contains BrowseList.
 */

import type { SetupChoice, SetupOverview } from '../shapes';
import { Button } from '../controls/button';
import { stageWords } from './experts-group';

export function BrowseList({
  label,
  items,
  progress,
  asking,
  onAdd,
}: {
  label: string;
  items: SetupChoice[];
  progress: SetupOverview['progress'];
  asking: ReadonlySet<string>;
  onAdd: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="home-card home-conns" aria-label={label}>
      <h2 className="home-card__label">{label.toUpperCase()}</h2>
      {items.some((item) => progress?.expert === item.id) && progress !== null && (
        <p className="tg-note" role="status">
          {stageWords(progress)}
        </p>
      )}
      <details>
        <summary className="tg-note">Browse and add</summary>
        <ul className="home-list home-conns__list">
          {items.map((item) => {
            const working = progress?.expert === item.id || asking.has(item.id);
            return (
              <li key={item.id}>
                <div className="home-conn">
                  <div className="home-conn__head">
                    <span className="home-entry__body">
                      <span className="home-entry__title" title={item.name}>
                        {item.name}
                      </span>
                      <span className="home-entry__preview" title={item.description}>
                        {item.description}
                      </span>
                    </span>
                    <Button
                      variant="secondary"
                      aria-label={`Add ${item.name}`}
                      disabled={working}
                      onClick={() => onAdd(item.id)}
                    >
                      Add
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </section>
  );
}
