/**
 * One paired computer, browser or AI tool on Devices: its name and standing, with Rename in
 * place and a Revoke that asks first. Contains DeviceRowItem.
 */
import { useState } from 'react';
import { Button } from '../controls/button';
import { seenWords, dayWords } from '../shapes';
import type { DeviceRow } from '../shapes';
import { Place, StandingLabel } from './place-row';

const KIND_WORDS: Record<string, string> = {
  desktop: 'Desktop',
  browser: 'Browser',
  node: 'Computer',
  mcp_client: "Reads and adds to Scout's memory",
};
const TILE: Record<string, string> = { desktop: 'PC', browser: 'C', node: 'PC', mcp_client: 'AI' };

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
  const meta = aiTool
    ? `${KIND_WORDS['mcp_client']} · ${device.lastSeen === null ? 'not used yet' : `last used ${seenWords(device.lastSeen)}`}`
    : `${KIND_WORDS[device.kind] ?? 'Device'} · paired ${dayWords(device.pairedAt)}`;
  const words = online
    ? 'Online now'
    : device.lastSeen === null
      ? 'Not seen yet'
      : `Last seen ${seenWords(device.lastSeen)}`;

  const save = async (): Promise<void> => {
    const name = draft.trim();
    if (name !== '' && name !== device.name) await onRename(name);
    setMode('view');
  };

  return (
    <li className="cx-item">
      <Place
        tile={TILE[device.kind] ?? 'PC'}
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
        <StandingLabel standing={online ? 'connected' : 'not-set-up'} words={words} />
        {mode === 'rename' ? (
          <>
            <Button variant="primary" onClick={() => void save()}>
              Save
            </Button>
            <Button variant="quiet" onClick={() => setMode('view')}>
              Cancel
            </Button>
          </>
        ) : (
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
        <div className="dv-confirm" role="alert">
          <span>
            {aiTool
              ? `Revoke ${device.name}? It can no longer read or add to Scout's memory. What it already added stays; remove it under What Scout remembers.`
              : `Revoke ${device.name}? It stops working right away and loses access to Scout. You can pair it again with a new code.`}
          </span>
          <Button variant="quiet" onClick={() => setMode('view')}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => void onRevoke()}>
            Revoke
          </Button>
        </div>
      )}
    </li>
  );
}
