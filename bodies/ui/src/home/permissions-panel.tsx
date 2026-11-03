/**
 * Home's Permissions list, under Settings: every tool Scout can use, grouped by where it comes
 * from (built in, this desktop, the browser, each connected app), each with one Off, Ask or Auto
 * control. The brain owns the modes and says which a tool allows; this lists them, sets one on a
 * click and reads again when the brain says they changed. Contains PermissionsPanel.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '../controls/button';
import { ThreeWay, type ThreeWayOption } from '../controls/three-way';
import { useHostBridge } from '../host-bridge';
import type { PermissionRow } from '../host-bridge';

type Mode = PermissionRow['mode'];

interface Group {
  source: string;
  title: string;
  rows: PermissionRow[];
}

/** Built in first, then this desktop, other bodies (the browser), then apps by name. */
function rank(source: string): number {
  if (source === 'built_in') return 0;
  if (source === 'body:desktop') return 1;
  return source.startsWith('body:') ? 2 : 3;
}

function groupBySource(rows: PermissionRow[]): Group[] {
  const bySource = new Map<string, PermissionRow[]>();
  for (const row of rows) bySource.set(row.source, [...(bySource.get(row.source) ?? []), row]);
  return [...bySource]
    .map(([source, list]) => ({ source, title: list[0]?.source_name ?? source, rows: list }))
    .sort((a, b) => rank(a.source) - rank(b.source) || a.title.localeCompare(b.title));
}

/** The tool's name without its source prefix: the group heading already says where it is from. */
function shortName(row: PermissionRow): string {
  const at = row.name.indexOf('__');
  return at < 0 ? row.name : row.name.slice(at + 2);
}

/** What the brain lets this tool be: a person-only or self-asking tool is never Auto, and a
 * server tool (run by Anthropic, never gated) is never Ask. */
function optionsFor(row: PermissionRow): ThreeWayOption[] {
  const options: ThreeWayOption[] = [{ value: 'off', label: 'Off' }];
  if (row.server_tool !== true) options.push({ value: 'ask', label: 'Ask' });
  if (!row.person_only && row.self_asks !== true) options.push({ value: 'auto', label: 'Auto' });
  return options;
}

/** A self-asking tool reports auto (its own ask is the gate); Home shows that as Ask. */
function shownMode(row: PermissionRow): Mode {
  return row.self_asks === true && row.mode !== 'off' ? 'ask' : row.mode;
}

export function PermissionsPanel() {
  const bridge = useHostBridge();
  const idPrefix = useId();
  const [rows, setRows] = useState<PermissionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The locked tool whose Auto waits on the person's Confirm.
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

  const choose = (row: PermissionRow, mode: Mode): void => {
    // A locked tool runs without asking once on Auto, so say so first.
    if (row.locked && mode === 'auto') {
      setWarning(row.name);
      return;
    }
    apply(row.name, mode);
  };

  // Closing the warning hands focus back to the control that opened it.
  const controlId = (name: string): string => `${idPrefix}-control-${name}`;
  const closeWarning = (name: string): void => {
    setWarning(null);
    document
      .getElementById(controlId(name))
      ?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
      ?.focus();
  };

  const apply = (name: string, mode: Mode): void => {
    closeWarning(name);
    void bridge
      .setPermission(name, mode)
      // Read again either way: on success for hosts that never send the change, on a
      // refusal so the control shows what the brain really holds.
      .catch((error: unknown) => console.error('could not set permission', error))
      .then(refresh);
  };

  return (
    <section className="home-card home-perms" aria-label="Permissions">
      <h2 className="home-card__label">PERMISSIONS</h2>
      <p>
        Off: Scout leaves the tool alone and finds another way. Ask: Scout checks with you first.
        Auto: it just does it. Tools that only read start on Auto.
      </p>
      {failed && rows === null && (
        <p role="alert">
          Tagalong could not read the permissions. They load again when Home reopens or a permission
          changes.
        </p>
      )}
      {rows !== null && rows.length === 0 && <p>Scout has no tools yet.</p>}
      {rows !== null &&
        groupBySource(rows).map((group) => {
          const headingId = `${idPrefix}-group-${group.source}`;
          return (
            <div key={group.source} className="perm-group">
              <h3 id={headingId} className="perm-group__title">
                {group.title}
              </h3>
              <ul aria-labelledby={headingId} className="perm-list">
                {group.rows.map((row, index) => {
                  const labelId = `${idPrefix}-${group.source}-${index}`;
                  const classes = ['perm-row'];
                  if (!row.online) classes.push('perm-row--offline');
                  if (row.mode === 'off') classes.push('perm-row--off');
                  return (
                    <li key={row.name} className={classes.join(' ')}>
                      <span className="perm-row__body">
                        <span id={labelId} className="perm-row__name">
                          {shortName(row)}
                        </span>
                        <span className="perm-row__text">{row.description}</span>
                        {row.person_only && <span className="perm-row__note">Always asks</span>}
                        {row.locked && !row.person_only && (
                          <span className="perm-row__note">Risky action</span>
                        )}
                        {row.self_asks === true && (
                          <span className="perm-row__note">Asks itself</span>
                        )}
                        {!row.online && <span className="perm-row__note">Not connected</span>}
                      </span>
                      <span id={controlId(row.name)}>
                        <ThreeWay
                          labelledBy={labelId}
                          value={shownMode(row)}
                          options={optionsFor(row)}
                          describedBy={warning === row.name ? `${labelId}-warning` : undefined}
                          onChange={(mode) => choose(row, mode as Mode)}
                        />
                      </span>
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
                            This is a risky action. If you turn it to Auto, Scout will no longer ask
                            you before doing it.
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
            </div>
          );
        })}
    </section>
  );
}
