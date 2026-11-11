/**
 * Home's "Where things run" card on Overview: each connected app by command or web address,
 * Claude Code as a local process, and how Scout reads this PC's screen (reading-rows.tsx).
 * The brain itself has its own card (brain-card.tsx). Read-only; the brain owns all of it,
 * so this reads again when it says changed. Exports LINK, the words for the link states.
 */

import { useCallback, useEffect, useState } from 'react';
import { readingRowsOf, type AppInfo, type ReadingRowView } from '../shapes';
import { useHostBridge, type BrainLink } from '../host-bridge';
import { STATUS_CHIP, STATUS_DOT, STATUS_WORDS } from './connection-row';
import { ReadingRows } from './reading-rows';

// Link states reuse the apps' dots; words say it too, so colour never carries it alone.
export const LINK: Record<BrainLink['status'], { words: string; dot: string; chip: string }> = {
  online: { words: 'Connected', dot: STATUS_DOT.connected, chip: STATUS_CHIP.connected },
  connecting: { words: 'Connecting', dot: STATUS_DOT.connecting, chip: STATUS_CHIP.connecting },
  offline: { words: 'Offline', dot: STATUS_DOT.off, chip: STATUS_CHIP.off },
  outdated: {
    words: 'Needs update',
    dot: STATUS_DOT['needs-sign-in'],
    chip: STATUS_CHIP['needs-sign-in'],
  },
};

// Static on purpose: every expert is started locally by the brain.
const EXPERTS = 'Runs on this machine, started by the brain';

/** Where an app runs: its web address, or the command line the brain starts. */
function describeApp(app: AppInfo): string {
  return app.url || [app.command, ...(app.args ?? [])].join(' ').trim();
}

export function WhereThingsRun() {
  const bridge = useHostBridge();
  const [link, setLink] = useState<BrainLink | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [reading, setReading] = useState<ReadingRowView[]>([]);

  const refresh = useCallback(() => {
    void bridge.brainLink().then(setLink, () => undefined);
    // Offline the list call fails; the note below covers it, and apps only render when online.
    void bridge.listConnections().then(
      (latest) => setApps(latest.apps),
      () => undefined,
    );
  }, [bridge]);

  const refreshReading = useCallback(() => {
    // Offline there is nothing to read: no rows hide the group.
    void bridge.readingStatus().then(
      (json) => setReading(readingRowsOf(json)),
      () => setReading([]),
    );
  }, [bridge]);

  useEffect(() => {
    refresh();
    refreshReading();
    // Look again at how this PC reads the screen: the person may have fixed it since.
    void bridge.readingRecheck().catch(() => undefined);
    const stopBrain = bridge.onBrainChanged((what) => {
      if (what === 'link' || what === 'apps') refresh();
      if (what === 'link' || what === 'reading') refreshReading();
    });
    const stopTurn = bridge.onTurnEvent((event) => {
      if (event.type === 'connections.changed') refresh();
    });
    return () => {
      stopBrain();
      stopTurn();
    };
  }, [bridge, refresh, refreshReading]);

  if (link === null) return null;

  return (
    <section className="home-card home-card--run" aria-label="Where things run">
      <h2 className="home-card__label">Where things run</h2>
      {link.status !== 'online' ? (
        <p>Connected apps show up when the brain is connected.</p>
      ) : (
        apps.map((app) => (
          <p key={app.id} className="home-card__row home-card__row--app">
            <span className="home-conn__initial" aria-hidden="true">
              {app.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="home-entry__body">
              <strong>{app.name}</strong>
              <span className="home-entry__preview">{describeApp(app)}</span>
            </span>
            <span className={STATUS_CHIP[app.status]}>
              <span className={STATUS_DOT[app.status]} aria-hidden="true" />{' '}
              {STATUS_WORDS[app.status]}
            </span>
          </p>
        ))
      )}
      <ReadingRows rows={reading} />

      <p className="home-card__row home-card__row--app">
        <span className="home-conn__initial" aria-hidden="true">
          C
        </span>
        <span className="home-entry__body">
          <strong>Claude Code</strong>
          <span className="home-entry__preview">{EXPERTS}</span>
        </span>
      </p>
    </section>
  );
}
