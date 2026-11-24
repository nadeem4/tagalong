/**
 * One row of Devices: an icon tile (a gold dot on the one that holds the brain), a name with
 * chips, a line of what it is and, on the right, its standing and actions. Contains Place,
 * StandingLabel and Standing.
 */
import type { ReactNode } from 'react';
import { DeviceIcon } from './device-icons';
import type { DeviceIconName } from './device-icons';

export type Standing = 'online' | 'off';

export interface Chip {
  label: string;
  tone?: 'ok' | 'rec';
}

export function StandingLabel({ standing, words }: { standing: Standing; words: string }) {
  const on = standing === 'online';
  return (
    <span className={on ? 'cx-status' : 'cx-status cx-status--off'}>
      <span className={on ? 'home-dot' : 'home-dot home-dot--off'} aria-hidden="true" />
      {words}
    </span>
  );
}

export function Place({
  icon,
  brain = false,
  name,
  chips = [],
  purpose,
  children,
}: {
  icon: DeviceIconName;
  /** This machine holds Scout's brain: a gold dot on its tile. */
  brain?: boolean;
  name: ReactNode;
  chips?: Chip[];
  purpose: string;
  children: ReactNode;
}) {
  return (
    <div className="cx-row">
      <span className="cx-tile dv-tile" aria-hidden="true">
        <DeviceIcon name={icon} />
        {brain && <i className="dv-tile__brain" />}
      </span>
      <div className="cx-row__main">
        <span className="cx-row__name">
          <span>{name}</span>
          {chips.map(({ label, tone }) => (
            <span key={label} className={tone ? `cx-chip cx-chip--${tone}` : 'cx-chip'}>
              {label}
            </span>
          ))}
        </span>
        <span className="cx-meta">{purpose}</span>
      </div>
      <div className="cx-row__side">{children}</div>
    </div>
  );
}
