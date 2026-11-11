/**
 * The Experts tab on Home's Connections page: "Your experts" (installed, Official then Community)
 * and "Add an expert": the brain's curated list open, Show more for the rest, a search over both.
 * An Official expert adds with the brain's own Allow card; a community one opens the check card
 * first. How an add ended shows on its row. Contains ExpertsTab.
 */
import { useRef, useState } from 'react';
import type { SetupChoice, SetupOverview } from '../shapes';
import { Button } from '../controls/button';
import { FactsLine } from '../setup/facts-line';
import { SearchField } from '../setup/search-field';
import { AddedStatus, OutcomeText, Tile, Waiting } from './app-group-row';
import { CheckCard } from './check-card';
import { ExpertsGroup, FailLine, InstallingCard } from './experts-group';
import { useOutcomes, type Outcome } from './outcome';

function ExpertItem({
  item,
  progress,
  working,
  outcome,
  failed,
  onAdd,
  onAddAnyway,
}: {
  item: SetupChoice;
  progress: SetupOverview['progress'];
  working: boolean;
  outcome: Outcome | undefined;
  failed: boolean;
  onAdd: () => void;
  onAddAnyway: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const installing = progress?.expert === item.id;
  const add = () => (item.official ? onAdd() : setChecking(true));

  return (
    <li className="cx-item">
      <div className="cx-row cx-row--top">
        <Tile name={item.name} />
        <div className="cx-row__main">
          <span className="cx-row__name">
            <span title={item.name}>{item.name}</span>
            <span className={item.official ? 'cx-chip cx-chip--official' : 'cx-chip'}>
              {item.official ? 'Official' : 'Community'}
            </span>
            {item.recommended && <span className="cx-chip cx-chip--rec">Recommended</span>}
            {item.tested && <span className="cx-chip cx-chip--quiet">Tested with Scout</span>}
            {!item.tested && !item.official && (
              <span className="cx-chip cx-chip--quiet">Not tested with Scout</span>
            )}
          </span>
          <span className="cx-row__desc">{item.description}</span>
          <FactsLine row={{ runs: 'pc', account: item.account }} />
        </div>
        <div className="cx-row__side">
          {outcome !== undefined && <OutcomeText outcome={outcome} />}
          {installing ? null : working ? (
            <Waiting />
          ) : item.added ? (
            outcome === undefined && <AddedStatus />
          ) : (
            outcome?.added !== true &&
            !failed && (
              <Button
                ref={addButton}
                variant="secondary"
                className="cx-fixed"
                aria-label={`Add ${item.name}`}
                onClick={add}
              >
                {item.official ? 'Add' : 'Add…'}
              </Button>
            )
          )}
        </div>
      </div>
      {installing && progress !== null && (
        <InstallingCard progress={progress} name={item.name} official={item.official} />
      )}
      {failed && !installing && <FailLine name={item.name} onRetry={add} />}
      {checking && (
        <CheckCard
          row={{ name: item.name, licence: item.licence, repo: item.repo }}
          busy={working}
          returnFocus={addButton}
          onBack={() => setChecking(false)}
          onAddAnyway={() => {
            setChecking(false);
            onAddAnyway();
          }}
        />
      )}
    </li>
  );
}

export function ExpertsTab({
  setup,
  asking,
  onAct,
  onAdd,
  onAddAnyway,
}: {
  setup: SetupOverview;
  asking: ReadonlySet<string>;
  onAct: (id: string) => Promise<Outcome | null>;
  onAdd: (id: string) => Promise<Outcome | null>;
  onAddAnyway: (id: string) => Promise<Outcome | null>;
}) {
  const [text, setText] = useState('');
  const [more, setMore] = useState(false);
  const { outcomes, track, clear } = useOutcomes();
  const { browseExperts: items, progress, failed } = setup;

  const split = setup.showMoreFrom ?? items.length;
  const term = text.trim().toLowerCase();
  const found = (item: SetupChoice) =>
    `${item.name} ${item.description}`.toLowerCase().includes(term);
  // An expert whose setup failed is never hidden: its Try again must be in sight.
  const failedAt = failed === null ? -1 : items.findIndex((item) => item.id === failed.expert);
  const showRest = more || failedAt >= split;
  const searching = term !== '';

  const row = (item: SetupChoice) => (
    <ExpertItem
      key={item.id}
      item={item}
      progress={progress}
      working={asking.has(item.id)}
      outcome={outcomes.get(item.id)}
      failed={failed?.expert === item.id}
      onAdd={() => void track(item.id, onAdd(item.id))}
      onAddAnyway={() => void track(item.id, onAddAnyway(item.id))}
    />
  );
  const main = searching ? items.filter(found) : items.slice(0, split);
  const rest = !searching && showRest ? items.slice(split) : [];
  const hidden = items.slice(split);

  return (
    <>
      <ExpertsGroup
        experts={setup.experts}
        progress={progress}
        asking={asking}
        outcomes={outcomes}
        failedId={failed?.expert ?? null}
        onAct={(id) => void track(id, onAct(id))}
      />
      {items.length > 0 && (
        <section className="home-card" aria-label="Add an expert">
          <h2 className="home-card__label">Add an expert</h2>
          <p>Experts take on long jobs for Scout, on your own login.</p>
          <SearchField
            label="Search experts"
            placeholder="Codex, Goose, an agent for…"
            value={text}
            onChange={(value) => {
              setText(value);
              clear();
            }}
          />
          {main.length > 0 && (
            <ul className="cx-list" aria-label="Experts to add">
              {main.map(row)}
            </ul>
          )}
          {searching && main.length === 0 && (
            <div className="cx-empty">
              <p className="cx-empty__lead">No experts match &quot;{text.trim()}&quot;.</p>
            </div>
          )}
          {rest.length > 0 && (
            <>
              <p className="cx-group-label">More experts that run on this PC</p>
              <ul className="cx-list" aria-label="More experts">
                {rest.map(row)}
              </ul>
            </>
          )}
          <div className="cx-foot">
            {!searching && !showRest && hidden.length > 0 && (
              <span className="cx-foot__more">
                <Button variant="secondary" onClick={() => setMore(true)}>
                  Show more
                </Button>
                <span className="cx-meta">{hidden.map((item) => item.name).join(', ')}…</span>
              </span>
            )}
            <span className="cx-meta cx-foot__note">
              Only experts that install and run on this PC are listed.
            </span>
          </div>
        </section>
      )}
    </>
  );
}
