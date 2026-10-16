/**
 * Home's "What Scout saw" page: every look and every send, newest first, grouped by day,
 * metadata only, with delete one and delete all. Contains SightLogView.
 */

import { useCallback, useEffect, useState } from 'react';
import type { SightKind, SightLogEntry } from '@tagalong/protocol';
import { SIGHT_LOG_DEFAULT_DAYS } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import type { TurnEvent } from '../host-bridge';
import { themeTokens as t } from '../theme/tokens';
import { brainLabel } from './brain-label';

/** Each kind's name and icon. A new kind of looking adds one entry here. */
const KINDS: Record<SightKind, { label: string; icon: string }> = {
  listed_windows: { label: 'Listed windows', icon: 'M2.5 3.5h8v6h-8zM5.5 6.5h8v6h-8z' },
  read_text: { label: 'Read text', icon: 'M3 4h10M3 7h10M3 10h7M3 13h5' },
  screenshot: {
    label: 'Screenshot',
    icon: 'M2.5 5.5v-3h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3M6 8a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  },
  sent_to_ai: { label: 'Sent to AI', icon: 'M8 13V3M4 7l4-4 4 4' },
  sent_to_expert: { label: 'Sent to expert', icon: 'M2.5 8h10M9 4.5L12.5 8 9 11.5' },
  read_element_names: {
    label: 'Read element names',
    icon: 'M2.5 2.5h11v11h-11zM5 5.5h6M5 8h6M5 10.5h3',
  },
  changed_by_talk: {
    label: 'Changed by talk',
    icon: 'M3 4.5h10M3 8h10M3 11.5h10M6 3v3M10 6.5v3M5 10v3',
  },
};

/** After these the log may have new rows. */
function changesLog(event: TurnEvent): boolean {
  return (
    event.type === 'turn.completed' ||
    event.type === 'turn.error' ||
    event.type === 'handoff.finished' ||
    event.type === 'watch.fired'
  );
}

function plural(count: number, one: string): string {
  return `${count.toLocaleString()} ${one}${count === 1 ? '' : 's'}`;
}

function where(entry: SightLogEntry, providerLabel: (providerId: string) => string): string {
  if (entry.kind === 'sent_to_ai' && entry.providerId !== undefined) {
    return brainLabel(providerLabel(entry.providerId), entry.providerId, entry.model ?? '');
  }
  if (entry.kind === 'sent_to_expert') return entry.expertName ?? 'An expert';
  const named = [entry.app, entry.title].filter((part) => part !== undefined).join(' · ');
  if (named !== '') return named;
  if (entry.kind === 'changed_by_talk') return 'Settings';
  return entry.kind === 'listed_windows' ? 'Every open window' : 'The screen';
}

function amounts(entry: SightLogEntry): string {
  return [
    entry.windows === undefined ? undefined : plural(entry.windows, 'window'),
    entry.chars === undefined ? undefined : plural(entry.chars, 'character'),
    entry.images === undefined || entry.images === 0 ? undefined : plural(entry.images, 'picture'),
    entry.source === 'ocr' ? 'read from pixels' : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ');
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Today, Yesterday or Earlier, by the local calendar. */
function groupOf(iso: string, now: Date): 'Today' | 'Yesterday' | 'Earlier' {
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const at = day(new Date(iso));
  const today = day(now);
  if (at >= today) return 'Today';
  const yesterday = day(new Date(today - 1));
  return at >= yesterday ? 'Yesterday' : 'Earlier';
}

const GROUPS = ['Today', 'Yesterday', 'Earlier'] as const;

const CSS = `
.sight-head { display: flex; align-items: flex-start; gap: ${t.space.xl}px; padding: ${t.space.xxl}px ${t.space.xxl}px 0; }
.sight-head > div:first-child { flex: 1; display: flex; flex-direction: column; gap: ${t.space.xs}px; }
.sight-head p { margin: 0; font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; }
.sight-group { margin: ${t.space.xl}px ${t.space.xxl}px ${t.space.xs}px; font-size: ${t.fontSize.small}px;
  font-weight: ${t.fontWeight.semibold}; letter-spacing: 0.4px; color: ${t.color.panelMuted}; text-transform: uppercase; }
.sight-row { display: flex; align-items: flex-start; gap: ${t.space.lg}px; padding: ${t.space.md}px;
  border-radius: ${t.radius.row}px; color: ${t.color.panelText}; }
.sight-row:hover { background: ${t.color.panelTile}; }
.sight-row__time { flex: none; width: 44px; padding-top: 1px; font-size: ${t.fontSize.small}px;
  color: ${t.color.panelMuted}; font-variant-numeric: tabular-nums; }
.sight-row__icon { flex: none; padding-top: 1px; color: ${t.color.panelMuted}; }
.sight-row__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.sight-row__kind { font-size: ${t.fontSize.field}px; font-weight: ${t.fontWeight.semibold}; }
.sight-row__where { font-size: ${t.fontSize.body}px; color: ${t.color.panelText};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sight-row__amount { font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.sight-row__delete { flex: none; width: 28px; height: 28px; border: 0; border-radius: ${t.radius.small}px;
  background: transparent; color: ${t.color.panelMuted}; cursor: pointer; font-size: 16px; line-height: 1; }
.sight-row__delete:hover { background: ${t.color.panelLine}; color: ${t.color.panelText}; }
`;

/**
 * Home's "What Scout saw": every time Scout looked at the screen or sent something away,
 * newest first, grouped by day. Metadata only, as the engine keeps it: the kind, the app
 * and window, the destination and the counts. Each row can be deleted, or all of them.
 */
export function SightLogView({
  name,
  days = SIGHT_LOG_DEFAULT_DAYS,
  providerLabel = (providerId) => providerId,
}: {
  name: string;
  days?: number;
  providerLabel?: (providerId: string) => string;
}) {
  const bridge = useHostBridge();
  const [entries, setEntries] = useState<SightLogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = useCallback(() => {
    const list = bridge.listSightLog;
    if (list === undefined) return;
    list
      .call(bridge)
      .then((latest) => {
        setFailed(false);
        setEntries(latest);
      })
      .catch((error: unknown) => {
        console.error('could not list what Scout saw', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onTurnEvent((event) => {
      if (changesLog(event)) refresh();
    });
  }, [bridge, refresh]);

  const remove = (id: string): void => {
    void bridge
      .deleteSightLog?.(id)
      .then(() => setEntries((current) => (current ?? []).filter((entry) => entry.id !== id)))
      .catch((error: unknown) => console.error('could not delete a record', error));
  };
  const clear = (): void => {
    setConfirming(false);
    void bridge
      .clearSightLog?.()
      .then(() => setEntries([]))
      .catch((error: unknown) => console.error('could not delete the records', error));
  };

  if (bridge.listSightLog === undefined) {
    return <p className="home-note">This record is not available here.</p>;
  }

  const now = new Date();
  const list = entries ?? [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>{CSS}</style>
      <div className="sight-head">
        <div>
          <h1 className="home-title">What {name} saw</h1>
          <p>
            Kept {days} {days === 1 ? 'day' : 'days'}. Deleting removes this record, not what was
            already sent.
          </p>
        </div>
        {list.length > 0 &&
          (confirming ? (
            <span className="home-danger">
              <button type="button" className="tg-btn-quiet" onClick={clear}>
                Delete all for good
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(false)}>
                Keep them
              </button>
            </span>
          ) : (
            <span className="home-danger">
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(true)}>
                Delete all
              </button>
            </span>
          ))}
      </div>
      {failed && entries === null && (
        <p className="home-note" role="alert">
          Tagalong could not read this record. Reopen Home to try again.
        </p>
      )}
      {entries !== null && list.length === 0 && (
        <p className="home-note">{name} hasn&apos;t looked at anything yet.</p>
      )}
      {GROUPS.map((group) => {
        const rows = list.filter((entry) => groupOf(entry.at, now) === group);
        if (rows.length === 0) return null;
        return (
          <section key={group}>
            <h2 className="sight-group">{group}</h2>
            <ul aria-label={group} className="home-activity">
              {rows.map((entry) => (
                <Row
                  key={entry.id}
                  entry={entry}
                  where={where(entry, providerLabel)}
                  onDelete={() => remove(entry.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Row({
  entry,
  where: destination,
  onDelete,
}: {
  entry: SightLogEntry;
  where: string;
  onDelete: () => void;
}) {
  const kind = KINDS[entry.kind] ?? { label: entry.kind, icon: '' };
  const amount = amounts(entry);
  return (
    <li className="sight-row">
      <span className="sight-row__time">{time(entry.at)}</span>
      <svg
        className="sight-row__icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={kind.icon} />
      </svg>
      <span className="sight-row__body">
        <span className="sight-row__kind">{kind.label}</span>
        <span className="sight-row__where" title={destination}>
          {destination}
        </span>
        {amount !== '' && <span className="sight-row__amount">{amount}</span>}
      </span>
      <button
        type="button"
        className="sight-row__delete"
        aria-label={`Delete this record: ${kind.label}, ${time(entry.at)}`}
        onClick={onDelete}
      >
        ×
      </button>
    </li>
  );
}
