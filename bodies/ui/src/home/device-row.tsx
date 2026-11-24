/**
 * One paired computer, browser or AI tool on Devices: its name and standing, with Rename in
 * place and a Revoke that asks first, in the row, as Remove does on Connections. Contains
 * DeviceRowItem.
 */
import { useState } from 'react';
import { Button } from '../controls/button';
import type { DeviceRow } from '../shapes';
import { dayLabel, time } from './approval-history';
import { Place, StandingLabel } from './place-row';

const KINDS: Record<string, { tile: string; label: string }> = {
  desktop: { tile: 'PC', label: 'Desktop' },
  browser: { tile: 'C', label: 'Browser' },
  node: { tile: 'PC', label: 'Computer' },
  mcp_client: { tile: 'AI', label: "Reads and adds to Scout's memory" },
};
const OTHER = { tile: 'PC', label: 'Device' };

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
  const aiTool = device.kind === 'mcp_client';
  const kind = KINDS[device.kind] ?? OTHER;
  const meta = aiTool
    ? `${kind.label} · ${device.lastSeen === null ? 'not used yet' : `last used ${when(device.lastSeen)}`}`
    : `${kind.label} · paired ${dayLabel(device.pairedAt)}`;

  const save = async (): Promise<void> => {
    const name = draft.trim();
    if (name !== '' && name !== device.name) await onRename(name);
    setMode('view');
  };

  return (
    <li className="cx-item">
      <Place
        tile={kind.tile}
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
        chips={[...(fresh ? ['New'] : []), ...(aiTool ? ['Memory'] : [])]}
        purpose={meta}
      >
        <StandingLabel
          standing={online ? 'connected' : 'not-set-up'}
          words={seenWords(device, online)}
        />
        {mode === 'rename' && (
          <>
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
            <Button variant="quiet" onClick={() => setMode('view')}>
              Cancel
            </Button>
          </>
        )}
        {mode === 'revoke' && (
          <>
            <Button
              variant="danger"
              aria-label={`Yes, revoke ${device.name}`}
              onClick={() => void onRevoke()}
            >
              Yes, revoke
            </Button>
            <Button
              variant="secondary"
              aria-label={`Keep ${device.name}`}
              onClick={() => setMode('view')}
            >
              Keep
            </Button>
          </>
        )}
        {mode === 'view' && (
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(device.name);
                setMode('rename');
              }}
            >
              Rename
            </Button>
            <Button variant="quiet" onClick={() => setMode('revoke')}>
              Revoke
            </Button>
          </>
        )}
      </Place>
      {mode === 'revoke' && (
        <p role="alert" className="tg-note cx-row__note">
          {aiTool
            ? `Revoke ${device.name}? It can no longer read or add to Scout's memory. What it already added stays; remove it under What Scout remembers.`
            : `Revoke ${device.name}? It stops working right away and loses access to Scout. You can pair it again with a new code.`}
        </p>
      )}
    </li>
  );
}
