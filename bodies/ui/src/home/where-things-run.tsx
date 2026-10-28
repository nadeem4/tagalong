/**
 * Home's "Where things run" card on Overview: the address the desktop dials the brain at (with
 * link state), each connected app by command or web address, and Claude Code as a local
 * process. Read-only; the brain owns all of it, so this reads again when it says changed.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AppInfo } from '@tagalong/protocol';
import { useHostBridge, type BrainLink } from '../host-bridge';
import { STATUS_DOT, STATUS_WORDS } from './connections-panel';

// Link states reuse the apps' dots; words say it too, so colour never carries it alone.
const LINK: Record<BrainLink['status'], { words: string; dot: string }> = {
  online: { words: 'Connected', dot: STATUS_DOT.connected },
  connecting: { words: 'Connecting', dot: STATUS_DOT.connecting },
  offline: { words: 'Offline', dot: STATUS_DOT.off },
  outdated: { words: 'Needs update', dot: STATUS_DOT['needs-sign-in'] },
};

// Static on purpose: Claude Code is the one expert and the brain starts it locally.
const EXPERTS = 'Claude Code · runs on this machine, started by the brain';

/** Where an app runs: its web address, or the command line the brain starts. */
function describeApp(app: AppInfo): string {
  return app.url || [app.command, ...(app.args ?? [])].join(' ').trim();
}

export function WhereThingsRun() {
  const bridge = useHostBridge();
  const [link, setLink] = useState<BrainLink | null>(null);
  const [apps, setApps] = useState<AppInfo[]>([]);

  const refresh = useCallback(() => {
    void bridge.brainLink?.().then(setLink, () => undefined);
    // Offline the list call fails; the note below covers it, and apps only render when online.
    void bridge.listConnections?.().then(
      (latest) => setApps(latest.apps),
      () => undefined,
    );
  }, [bridge]);

  useEffect(() => {
    refresh();
    const stopBrain = bridge.onBrainChanged?.((what) => {
      if (what === 'link' || what === 'apps') refresh();
    });
    const stopTurn = bridge.onTurnEvent((event) => {
      if (event.type === 'connections.changed') refresh();
    });
    return () => {
      stopBrain?.();
      stopTurn();
    };
  }, [bridge, refresh]);

  if (bridge.brainLink === undefined || link === null) return null;
  const state = LINK[link.status];

  return (
    <section className="home-card home-card--run" aria-label="Where things run">
      <h2 className="home-card__label">WHERE THINGS RUN</h2>
      <p className="home-card__row">
        <strong>Brain · {link.addr}</strong>
        <span>
          <span className={state.dot} aria-hidden="true" />
          {state.words}
        </span>
      </p>
      {link.status !== 'online' ? (
        <p>Connected apps show up when the brain is connected.</p>
      ) : (
        apps.map((app) => (
          <p key={app.id} className="home-card__row">
            <strong>{[app.name, describeApp(app)].filter(Boolean).join(' · ')}</strong>
            <span>
              <span className={STATUS_DOT[app.status]} aria-hidden="true" />
              {STATUS_WORDS[app.status]}
            </span>
          </p>
        ))
      )}
      <p>{EXPERTS}</p>
    </section>
  );
}
