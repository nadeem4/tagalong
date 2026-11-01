/**
 * Home's Permissions list, under Settings: each tool Scout can use, with a switch for whether
 * Scout asks first (Ask) or just does it (Auto). The brain owns the modes; this lists them,
 * sets one on a click and reads again when the brain says they changed. Contains PermissionsPanel.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '../controls/button';
import { Toggle } from '../controls/toggle';
import { useHostBridge } from '../host-bridge';
import type { PermissionRow } from '../host-bridge';

export function PermissionsPanel() {
  const bridge = useHostBridge();
  const idPrefix = useId();
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The locked tool whose Auto switch waits on the person's Confirm.
  const [warning, setWarning] = useState<string | null>(null);

  const refresh = useCallback(() => {
    bridge
      .listPermissions()
      .then((latest) => {
        setFailed(false);
        setRows(latest);
      })
      .catch((error: unknown) => {
        console.error('could not list permissions', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onBrainChanged((what) => {
      if (what === 'permissions') refresh();
    });
  }, [bridge, refresh]);

  const choose = (row: PermissionRow): void => {
    const mode = row.mode === 'auto' ? 'ask' : 'auto';
    // A locked tool runs without asking once on Auto, so say so first.
    if (row.locked && mode === 'auto') {
      setWarning(row.name);
      return;
    }
    apply(row.name, mode);
  };

  // Closing the warning hands focus back to the switch that opened it.
  const switchId = (name: string): string => `${idPrefix}-switch-${name}`;
  const closeWarning = (name: string): void => {
    setWarning(null);
    document.getElementById(switchId(name))?.focus();
  };

  const apply = (name: string, mode: 'ask' | 'auto'): void => {
    closeWarning(name);
    void bridge
      .setPermission(name, mode)
      // Read again either way: on success for hosts that never send the change, on a
      // refusal so the switch shows what the brain really holds.
      .catch((error: unknown) => console.error('could not set permission', error))
      .then(refresh);
  };

  return (
    <section className="home-card home-perms" aria-label="Permissions">
      <h2 className="home-card__label">PERMISSIONS</h2>
      <p>
        Ask: Scout checks with you first. Auto: it just does it. Tools that only read start on Auto.
      </p>
      {failed && rows === null && (
        <p role="alert">
          Tagalong could not read the permissions. They load again when Home reopens or a permission
          changes.
        </p>
      )}
      {rows !== null && rows.length === 0 && <p>Scout has no tools yet.</p>}
      {rows !== null && rows.length > 0 && (
        <ul aria-label="Permissions" className="perm-list">
          {rows.map((row, index) => {
            const labelId = `${idPrefix}-${index}`;
            const selfAsks = row.self_asks === true;
            const fixed = selfAsks || !row.online;
            return (
              <li key={row.name} className={row.online ? 'perm-row' : 'perm-row perm-row--offline'}>
                <span className="perm-row__body">
                  <span id={labelId} className="perm-row__name">
                    {row.name}
                  </span>
                  <span className="perm-row__text">{row.description}</span>
                  {row.locked && <span className="perm-row__note">Risky action</span>}
                  {selfAsks && <span className="perm-row__note">Asks itself</span>}
                  {!row.online && <span className="perm-row__note">Not connected</span>}
                </span>
                <span className="perm-row__mode">{row.mode === 'auto' ? 'Auto' : 'Ask'}</span>
                <Toggle
                  id={switchId(row.name)}
                  label={row.name}
                  checked={row.mode === 'auto'}
                  disabled={fixed}
                  describedBy={warning === row.name ? `${labelId}-warning` : undefined}
                  onChange={() => choose(row)}
                />
                {warning === row.name && (
                  <div
                    id={`${labelId}-warning`}
                    role="alert"
                    className="perm-row__warning"
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') closeWarning(row.name);
                    }}
                  >
                    <p>
                      This is a risky action. If you turn it to Auto, Scout will no longer ask you
                      before doing it.
                    </p>
                    <Button variant="primary" onClick={() => apply(row.name, 'auto')}>
                      Confirm
                    </Button>
                    <Button variant="quiet" autoFocus onClick={() => closeWarning(row.name)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
