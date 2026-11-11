/**
 * One app in "Your apps" on Home's Connections page: tile, name with its Official or Community
 * chip, a meta line, quiet Restart and Remove, the status and the On/Off switch. Also the status
 * words and dots Overview's "Where things run" reuses.
 * Contains ConnectionRow, STATUS_WORDS, STATUS_DOT, STATUS_CHIP and SAME_MACHINE.
 */

import { useState } from 'react';
import type { AppInfo } from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { Tile } from './app-group-row';

// The brain opens the page on its own machine, so a brain elsewhere cannot finish a sign-in.
export const SAME_MACHINE =
  'Signing in opens your browser, so Scout’s brain and the browser must be on the same computer.';

export const STATUS_WORDS: Record<AppInfo['status'], string> = {
  off: 'Off',
  connecting: 'Connecting',
  connected: 'Connected',
  'needs-sign-in': 'Needs sign-in',
  error: 'Not working',
};

export const STATUS_DOT: Record<AppInfo['status'], string> = {
  off: 'home-dot home-dot--off',
  connecting: 'home-dot home-dot--warn',
  connected: 'home-dot',
  'needs-sign-in': 'home-dot home-dot--warn',
  error: 'home-dot home-dot--err',
};

// Colour is never the only signal: the chip always carries the words too.
export const STATUS_CHIP: Record<AppInfo['status'], string> = {
  off: 'tg-chip',
  connecting: 'tg-chip tg-chip--warn',
  connected: 'tg-chip tg-chip--ok',
  'needs-sign-in': 'tg-chip tg-chip--warn',
  error: 'tg-chip tg-chip--err',
};

const TRANSPORT_WORDS: Record<AppInfo['transport'], string> = {
  stdio: 'Runs on your PC',
  http: 'Runs on the web',
};

export function ConnectionRow({
  app,
  trust,
  onSwitch,
  onRestart,
  onSignIn,
  onRemove,
}: {
  app: AppInfo;
  /** Who made it, when the brain says; null shows no chip. */
  trust: 'official' | 'community' | null;
  onSwitch: () => void;
  onRestart: () => void;
  onSignIn: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { name, tools } = app;
  const toolCount = `${tools.length} tool${tools.length === 1 ? '' : 's'}`;
  // An oauth app that is connecting is waiting on the person's browser, not on the network.
  const waiting = app.auth === 'oauth' && app.status === 'connecting';
  const needsSignIn = app.auth === 'oauth' && app.status === 'needs-sign-in';

  return (
    <li className="cx-item">
      <section className="cx-row" aria-label={name}>
        <Tile name={name} />
        <div className="cx-row__main">
          <span className="cx-row__name">
            <span title={name}>{name}</span>
            {trust !== null && (
              <span className={trust === 'official' ? 'cx-chip cx-chip--official' : 'cx-chip'}>
                {trust === 'official' ? 'Official' : 'Community'}
              </span>
            )}
          </span>
          <span className="cx-meta">
            {TRANSPORT_WORDS[app.transport]} · {toolCount}
          </span>
        </div>
        <div className="cx-row__side">
          {needsSignIn && (
            <Button variant="primary" aria-label={`Sign in to ${name}`} onClick={onSignIn}>
              Sign in
            </Button>
          )}
          <span className="cx-quiet">
            <Button variant="quiet" aria-label={`Restart ${name}`} onClick={onRestart}>
              Restart
            </Button>
            {confirming ? (
              <>
                <Button variant="danger" aria-label={`Yes, remove ${name}`} onClick={onRemove}>
                  Yes, remove
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`Keep ${name}`}
                  onClick={() => setConfirming(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                variant="quiet"
                aria-label={`Remove ${name}`}
                onClick={() => setConfirming(true)}
              >
                Remove
              </Button>
            )}
          </span>
          <span className="cx-status">
            <span className={STATUS_DOT[app.status]} aria-hidden="true" />
            {waiting ? 'Waiting for the browser' : STATUS_WORDS[app.status]}
          </span>
          <Toggle checked={app.enabled} onChange={onSwitch} label={`Scout can use ${name}`} />
        </div>
      </section>
      {app.error !== '' && <p className="tg-error cx-row__note">{app.error}</p>}
      {(needsSignIn || waiting) && <p className="tg-note cx-row__note">{SAME_MACHINE}</p>}
    </li>
  );
}
