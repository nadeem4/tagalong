/**
 * Updates on Connections: the card header (Checked N minutes ago, Check for updates, Update all
 * (n)), the two "keep up to date automatically" switches, and the words and button a single row
 * carries (v1.2 → v1.3, Update, Updating…, Updated to v1.3.). The brain decides when an update
 * may run; this only asks and shows. Contains UpdatesBar, UpdateSide, updateMeta, updateVersion,
 * updateWaits, updateVisible, rowUpdate and UpdatesControls.
 */
import { useEffect, useState } from 'react';
import type { UpdateKind, UpdateRow, UpdatesState } from '../shapes';
import { pendingUpdates } from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { OutcomeText } from './app-group-row';

/** Everything the two tabs need to show and press updates; null while the brain has none. */
export interface UpdatesControls {
  state: UpdatesState;
  checking: boolean;
  onCheck: () => void;
  onUpdate: (kind: UpdateKind, id: string) => void;
  onUpdateAll: (kind: UpdateKind) => void;
  onAuto: (kind: UpdateKind, official: boolean, on: boolean) => void;
}

export function rowUpdate(
  controls: UpdatesControls | null,
  kind: UpdateKind,
  id: string,
): UpdateRow | undefined {
  return controls?.state.items.find((row) => row.kind === kind && row.id === id);
}

function checkedWords(checkedAt: string | null, now: number): string {
  if (checkedAt === null) return 'Not checked yet';
  const minutes = Math.max(0, Math.floor((now - Date.parse(checkedAt)) / 60_000));
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `Checked ${days} day${days === 1 ? '' : 's'} ago`;
}

export function UpdatesBar({
  title,
  kind,
  controls,
  now,
}: {
  title: string;
  kind: UpdateKind;
  controls: UpdatesControls;
  /** Fixed time for tests; otherwise the words follow the clock, once a minute. */
  now?: number;
}) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const { state } = controls;
  const pending = pendingUpdates(state, kind);
  const word = kind === 'app' ? 'apps' : 'experts';
  const groups = kind === 'app' ? state.auto.apps : state.auto.experts;
  const switchFor = (official: boolean) => {
    const group = official ? 'Official' : 'Community';
    const label = `Keep ${group} ${word} up to date automatically`;
    return (
      <div className="cx-auto__row">
        <div className="cx-auto__text">
          <span>{label}</span>
          {!official && (
            <span className="cx-meta">
              Off at first. Updates to code nobody has reviewed wait for you.
            </span>
          )}
        </div>
        <Toggle
          checked={official ? groups.official : groups.community}
          onChange={(on) => controls.onAuto(kind, official, on)}
          label={label}
        />
      </div>
    );
  };

  return (
    <>
      <div className="cx-card-top">
        <h2 className="home-card__label">{title}</h2>
        <div className="cx-card-tools">
          <span className="cx-meta">{checkedWords(state.checkedAt, now ?? clock)}</span>
          <Button variant="quiet" disabled={controls.checking} onClick={controls.onCheck}>
            Check for updates
          </Button>
          {pending > 0 && (
            <Button variant="secondary" onClick={() => controls.onUpdateAll(kind)}>
              Update all ({pending})
            </Button>
          )}
        </div>
      </div>
      <div className="cx-auto">
        {switchFor(true)}
        {switchFor(false)}
      </div>
    </>
  );
}

/** The version words of a row's meta line; null when there is nothing to say. */
export function updateVersion(row: UpdateRow): string | null {
  if (row.remote) return 'Always up to date';
  if (row.installed === '') return null;
  if (row.latest === null) return `v${row.installed}`;
  return `v${row.installed} → v${row.latest}`;
}

/** An update that is there but the person left on manual: it waits for their press. */
export function updateWaits(row: UpdateRow): boolean {
  return row.latest !== null && !row.auto && row.status === 'idle';
}

/** The version words and, last, "Waits for you"; null when there is nothing to say. */
export function updateMeta(row: UpdateRow): string | null {
  const version = updateVersion(row);
  if (!updateWaits(row)) return version;
  return version === null ? 'Waits for you' : `${version} · Waits for you`;
}

/** Whether UpdateSide has anything to show for this row. */
export function updateVisible(row: UpdateRow): boolean {
  return !row.remote && (row.status !== 'idle' || row.latest !== null);
}

/** What stands on the right of a row for its update: the button, or the words for how it is going. */
export function UpdateSide({ row, onUpdate }: { row: UpdateRow; onUpdate: () => void }) {
  if (row.remote) return null;
  if (row.status === 'updating') {
    return (
      <span className="cx-waiting">
        <span className="cx-spin" aria-hidden="true" />
        Updating…
      </span>
    );
  }
  if (row.status === 'waiting') {
    return (
      <span className="cx-waiting">
        <span className="cx-spin" aria-hidden="true" />
        Waiting for a job to finish…
      </span>
    );
  }
  if (row.status === 'updated') {
    return (
      <OutcomeText outcome={{ text: `Updated to v${row.installed}.`, error: false, added: true }} />
    );
  }
  if (row.latest === null) return null;
  return (
    <>
      {row.status === 'failed' && (
        <OutcomeText outcome={{ text: 'The update didn’t work.', error: true, added: false }} />
      )}
      <Button
        variant="secondary"
        className="cx-fixed"
        aria-label={`Update ${row.name}`}
        onClick={onUpdate}
      >
        Update
      </Button>
    </>
  );
}
