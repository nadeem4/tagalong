/**
 * One paired computer, browser or AI tool on Devices: its name and standing, with Rename in
 * place and a Revoke that asks first in a red line under the row. A refused rename or revoke
 * puts the row back and says so. Contains DeviceRowItem.
 */
import { useState } from 'react';
import { Button } from '../controls/button';
import type { DeviceRow } from '../shapes';
import { dayLabel, time } from './approval-history';
import type { DeviceIconName } from './device-icons';
import { Place, StandingLabel } from './place-row';

const KINDS: Record<string, { icon: DeviceIconName; label: string }> = {
  desktop: { icon: 'laptop', label: 'Desktop' },
  browser: { icon: 'globe', label: 'Browser' },
  node: { icon: 'pc', label: 'Computer' },
  mcp_client: { icon: 'term', label: "Reads and adds to Scout's memory" },
};

const when = (iso: string): string => `${dayLabel(iso)}, ${time(iso)}`;

function seenWords(device: DeviceRow, online: boolean): string {
  if (online) return 'Online now';
  if (device.lastSeen === null) return 'Not seen yet';
  return `Last seen ${when(device.lastSeen)}`;
}

export function DeviceRowItem({
  device,
  online,
  fresh,
  onRename,
  onRevoke,
}: {
  device: DeviceRow;
  online: boolean;
  fresh: boolean;
  onRename: (name: string) => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'revoke'>('view');
  const [draft, setDraft] = useState(device.name);
  const [failed, setFailed] = useState<string | null>(null);
  const aiTool = device.kind === 'mcp_client';
  const kind = KINDS[device.kind] ?? KINDS['node']!;
  const meta = aiTool
    ? `${kind.label} · ${device.lastSeen === null ? 'not used yet' : `last used ${when(device.lastSeen)}`}`
    : `${kind.label} · paired ${dayLabel(device.pairedAt)}`;

  const attempt = async (act: () => Promise<void>, words: string): Promise<void> => {
    setFailed(null);
    try {
      await act();
    } catch {
      setFailed(words);
    }
    setMode('view');
  };
  const save = async (): Promise<void> => {
    const name = draft.trim();
    if (name === '' || name === device.name) return setMode('view');
    await attempt(() => onRename(name), `Scout could not rename ${device.name}.`);
  };
  const start = (next: 'rename' | 'revoke'): void => {
    setFailed(null);
    setDraft(device.name);
    setMode(next);
  };

  return (
    <li className="cx-item">
      <Place
        icon={kind.icon}
        name={
          mode === 'rename' ? (
            <input
              className="cx-input"
              aria-label="Name"
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save();
                if (event.key === 'Escape') setMode('view');
              }}
            />
          ) : (
            device.name
          )
        }
        chips={[
          ...(fresh ? [{ label: 'New', tone: 'ok' as const }] : []),
          ...(aiTool ? [{ label: 'Memory' }] : []),
        ]}
        purpose={meta}
      >
        {mode === 'rename' ? (
          <>
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setMode('view')}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <StandingLabel standing={online ? 'online' : 'off'} words={seenWords(device, online)} />
            <Button variant="secondary" onClick={() => start('rename')}>
              Rename
            </Button>
            <Button variant="secondary" onClick={() => start('revoke')}>
              Revoke
            </Button>
          </>
        )}
      </Place>
      {mode === 'revoke' && (
        <div role="alert" className="dv-confirm">
          <span>
            <strong>Revoke {device.name}?</strong>{' '}
            {aiTool
              ? "It can no longer read or add to Scout's memory. What it already added stays; remove it under What Scout remembers."
              : 'It stops working right away and loses access to Scout. You can pair it again with a new code.'}
          </span>
          <Button variant="quiet" onClick={() => setMode('view')}>
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => void attempt(onRevoke, `Scout could not revoke ${device.name}.`)}
          >
            Revoke
          </Button>
        </div>
      )}
      {failed !== null && (
        <p role="alert" className="tg-note cx-row__note">
          {failed}
        </p>
      )}
    </li>
  );
}
