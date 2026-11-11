/**
 * One service in the app lists: its Official version first (Add is one press), the versions from
 * other makers behind a toggle. A community row says "Name, by maker" and opens the check card
 * before anything is added. One verb per row: Add, or Add… when a card comes first.
 * Contains AppGroupRow and AppItem.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { AppGroup, AppRow } from '../shapes';
import { Button } from '../controls/button';
import { FactsLine } from '../setup/facts-line';
import { Icon } from '../setup/icons';
import { CheckCard } from './check-card';
import type { Outcome } from './outcome';

export function Tile({ name }: { name: string }) {
  return (
    <span className="cx-tile" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** What stands on the right of a row after a press: the answer, the wait, or what ended it. */
export function OutcomeText({ outcome }: { outcome: Outcome }) {
  return (
    <span
      className={outcome.error ? 'cx-outcome cx-outcome--err' : 'cx-outcome'}
      role={outcome.error ? 'alert' : 'status'}
    >
      {outcome.added && <Icon name="check" />}
      {outcome.error && <Icon name="error" />}
      {outcome.text}
    </span>
  );
}

export function Waiting() {
  return (
    <span className="cx-waiting">
      <span className="cx-spin" aria-hidden="true" />
      Waiting for you…
    </span>
  );
}

/** "✓ Added" in place of Add on a curated row for something already installed. */
export function AddedStatus() {
  return (
    <span className="cx-status cx-status--off">
      <Icon name="check" />
      Added
    </span>
  );
}

export function AppItem({
  row,
  busy,
  outcome,
  onAdd,
  onAddAnyway,
  children,
}: {
  row: AppRow;
  busy: boolean;
  outcome: Outcome | undefined;
  onAdd: (row: AppRow) => void;
  onAddAnyway: (row: AppRow) => void;
  children?: ReactNode;
}) {
  const [checking, setChecking] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const label = row.official ? row.name : `${row.name}, by ${row.publisher}`;

  return (
    <li className="cx-item">
      <div className="cx-row cx-row--top">
        <Tile name={row.name} />
        <div className="cx-row__main">
          <span className="cx-row__name">
            <span title={row.official ? undefined : row.id}>{label}</span>
            <span className={row.official ? 'cx-chip cx-chip--official' : 'cx-chip'}>
              {row.official ? 'Official' : 'Community'}
            </span>
          </span>
          <span className="cx-row__desc">{row.why || row.description}</span>
          <FactsLine row={row} />
        </div>
        <div className="cx-row__side">
          {outcome !== undefined && <OutcomeText outcome={outcome} />}
          {busy ? (
            <Waiting />
          ) : row.added ? (
            outcome === undefined && <AddedStatus />
          ) : (
            outcome?.added !== true && (
              <Button
                ref={addButton}
                variant="secondary"
                className="cx-fixed"
                aria-label={`Add ${label}`}
                onClick={() => (row.official ? onAdd(row) : setChecking(true))}
              >
                {row.official ? 'Add' : 'Add…'}
              </Button>
            )
          )}
        </div>
      </div>
      {checking && (
        <CheckCard
          row={row}
          busy={busy}
          returnFocus={addButton}
          onBack={() => setChecking(false)}
          onAddAnyway={() => {
            setChecking(false);
            onAddAnyway(row);
          }}
        />
      )}
      {children}
    </li>
  );
}

export function AppGroupRow({
  group,
  busy,
  outcomes,
  onAdd,
  onAddAnyway,
}: {
  group: AppGroup;
  /** Ids whose call is running; they show "Waiting for you…" in place of the button. */
  busy: ReadonlySet<string>;
  outcomes: ReadonlyMap<string, Outcome>;
  onAdd: (row: AppRow) => void;
  onAddAnyway: (row: AppRow) => void;
}) {
  const { official, others } = group;
  const [open, setOpen] = useState(false);
  const item = (row: AppRow, children?: ReactNode) => (
    <AppItem
      key={row.id}
      row={row}
      busy={busy.has(row.id)}
      outcome={outcomes.get(row.id)}
      onAdd={onAdd}
      onAddAnyway={onAddAnyway}
    >
      {children}
    </AppItem>
  );

  // No official version: the community rows stand on their own, there is nothing to nest under.
  if (official === null) return <>{others.map((row) => item(row))}</>;

  const count = others.length;
  const more = count === 1 ? '1 more from another maker' : `${count} more from other makers`;
  return item(
    official,
    count > 0 && (
      <>
        <button
          type="button"
          className="cx-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? 'chevDown' : 'chevRight'} />
          {more}
        </button>
        {open && <ul className="cx-others">{others.map((row) => item(row))}</ul>}
      </>
    ),
  );
}
