/**
 * Home's Permissions list, under Settings: each tool Scout can use, with a switch for whether
 * Scout asks first (Ask) or just does it (Auto). The brain owns the modes; this lists them,
 * sets one on a click and reads again when the brain says they changed. Contains PermissionsPanel.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { PermissionRow } from '../host-bridge';

export function PermissionsPanel() {
  const bridge = useHostBridge();
  const idPrefix = useId();
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The locked tool whose Auto switch waits on the person's Confirm.
  const [warning, setWarning] = useState<string | null>(null);
  const switches = useRef(new Map<string, HTMLButtonElement>());

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
  const closeWarning = (name: string): void => {
    setWarning(null);
    switches.current.get(name)?.focus();
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
                <button
                  type="button"
                  role="switch"
                  className="tg-switch"
                  aria-checked={row.mode === 'auto'}
                  aria-labelledby={labelId}
                  aria-describedby={warning === row.name ? `${labelId}-warning` : undefined}
                  ref={(node) => {
                    if (node === null) switches.current.delete(row.name);
                    else switches.current.set(row.name, node);
                  }}
                  disabled={fixed}
                  onClick={() => choose(row)}
                >
                  {row.mode === 'auto' ? 'Auto' : 'Ask'}
                </button>
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
                    <button
                      type="button"
                      className="tg-btn"
                      onClick={() => apply(row.name, 'auto')}
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      className="tg-btn-quiet"
                      autoFocus
                      onClick={() => closeWarning(row.name)}
                    >
                      Cancel
                    </button>
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
