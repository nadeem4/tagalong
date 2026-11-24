/**
 * One row of Devices: a tile, a name with chips, a line of what it is and, on the right, its
 * standing and actions. Shared by the machines, the browser add-on, WhatsApp and the paired
 * devices. Contains Place, StandingLabel and Standing.
 */
import type { ReactNode } from 'react';

export type Standing = 'connected' | 'not-set-up' | 'offline';

const STANDING_WORDS: Record<Standing, string> = {
  connected: 'Connected',
  'not-set-up': 'Not set up',
  offline: 'Offline',
};
const STANDING_DOT: Record<Standing, string> = {
  connected: 'home-dot',
  'not-set-up': 'home-dot home-dot--off',
  offline: 'home-dot home-dot--warn',
};
const STANDING_CLASS: Record<Standing, string> = {
  connected: 'cx-status',
  'not-set-up': 'cx-status cx-status--off',
  offline: 'cx-status cx-status--warn',
};

export function StandingLabel({ standing, words }: { standing: Standing; words?: string }) {
  return (
    <span className={STANDING_CLASS[standing]}>
      <span className={STANDING_DOT[standing]} aria-hidden="true" />
      {words ?? STANDING_WORDS[standing]}
    </span>
  );
}

export function Place({
  tile,
  name,
  chips = [],
  purpose,
  children,
}: {
  tile: string;
  name: ReactNode;
  chips?: string[];
  purpose: string;
  children: ReactNode;
}) {
  return (
    <div className="cx-row">
      <span className="cx-tile" aria-hidden="true">
        {tile}
      </span>
      <div className="cx-row__main">
        <span className="cx-row__name">
          <span>{name}</span>
          {chips.map((chip) => (
            <span key={chip} className="cx-chip cx-chip--quiet">
              {chip}
            </span>
          ))}
        </span>
        <span className="cx-meta">{purpose}</span>
      </div>
      <div className="cx-row__side">{children}</div>
    </div>
  );
}
