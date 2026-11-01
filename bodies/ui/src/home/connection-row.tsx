/**
 * One app on Home's Connections page: its name and status chip, the On/Off switch and the
 * row's actions inline. Also the status words and dots Overview's "Where things run" reuses.
 * Contains ConnectionRow, STATUS_WORDS, STATUS_DOT and SAME_MACHINE.
 */

import { useState } from 'react';
import type { AppInfo } from '../shapes';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';

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
const STATUS_CHIP: Record<AppInfo['status'], string> = {
  off: 'tg-chip',
  connecting: 'tg-chip tg-chip--warn',
  connected: 'tg-chip tg-chip--ok',
  'needs-sign-in': 'tg-chip tg-chip--warn',
  error: 'tg-chip tg-chip--err',
};

const TRANSPORT_WORDS: Record<AppInfo['transport'], string> = {
  stdio: 'Runs on this PC',
  http: 'Web address',
};

export function ConnectionRow({
  app,
  onSwitch,
  onRestart,
  onSignIn,
  onRemove,
}: {
  app: AppInfo;
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
    <li>
      <section className="home-conn" aria-label={name}>
        <div className="home-conn__head">
          <span className="home-conn__initial" aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className="home-entry__body">
            <span className="home-entry__title" title={name}>
              {name}
            </span>
            <span className="home-entry__preview">
              {TRANSPORT_WORDS[app.transport]} · {toolCount}
            </span>
          </span>
          <span className={STATUS_CHIP[app.status]}>
            <span className={STATUS_DOT[app.status]} aria-hidden="true" />{' '}
            {waiting ? 'Waiting for the browser' : STATUS_WORDS[app.status]}
          </span>
          <Toggle checked={app.enabled} onChange={onSwitch} label={`Scout can use ${name}`} />
        </div>
        {app.error !== '' && <p className="tg-error">{app.error}</p>}
        {(needsSignIn || waiting) && <p className="tg-note">{SAME_MACHINE}</p>}
        <div className="home-conn__actions">
          {needsSignIn && (
            <Button variant="primary" aria-label={`Sign in to ${name}`} onClick={onSignIn}>
              Sign in
            </Button>
          )}
          <Button variant="secondary" aria-label={`Restart ${name}`} onClick={onRestart}>
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
              variant="secondary"
              aria-label={`Remove ${name}`}
              onClick={() => setConfirming(true)}
            >
              Remove
            </Button>
          )}
        </div>
      </section>
    </li>
  );
}
