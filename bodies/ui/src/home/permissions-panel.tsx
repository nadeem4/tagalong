/**
 * Home's Permissions list, under Settings: every tool Scout can use in plain words, in groups the
 * brain names, each group collapsed until opened, with a search box over all of them. The brain
 * owns the modes and the words; this lists them, sets one on a click and reads again when the
 * brain says they changed. Contains PermissionsPanel.
 */
import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { PermissionGroup as GroupInfo, PermissionRow } from '../host-bridge';
import { PermissionGroup, type Mode } from './permission-group';

const matches = (row: PermissionRow, term: string): boolean =>
  [row.title, row.line, row.info].some((text) => text.toLowerCase().includes(term));

export function PermissionsPanel() {
  const bridge = useHostBridge();
  const [list, setList] = useState<{ groups: GroupInfo[]; rows: PermissionRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const [term, setTerm] = useState('');

  const refresh = useCallback(() => {
    bridge
      .listPermissions()
      .then((latest) => {
        setFailed(false);
        setList(latest);
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

  const apply = (name: string, mode: Mode): void => {
    void bridge
      .setPermission(name, mode)
      // Read again either way: on success for hosts that never send the change, on a
      // refusal so the control shows what the brain really holds.
      .catch((error: unknown) => console.error('could not set permission', error))
      .then(refresh);
  };

  const toggle = (id: string): void =>
    setOpenIds((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const needle = term.trim().toLowerCase();
  const searching = needle !== '';
  const shown =
    list === null
      ? []
      : list.groups
          .map((group) => {
            const own = list.rows.filter((row) => row.group === group.id);
            return { group, rows: searching ? own.filter((row) => matches(row, needle)) : own };
          })
          .filter((entry) => entry.rows.length > 0);

  return (
    <section className="home-card home-perms" aria-label="Permissions">
      <h2 className="home-card__label">Permissions</h2>
      <p>Off: Scout leaves it alone. Ask: checks with you first. Auto: just does it.</p>
      {failed && list === null && (
        <p role="alert">
          Tagalong could not read the permissions. They load again when Home reopens or a permission
          changes.
        </p>
      )}
      {list !== null && list.rows.length === 0 && <p>Scout has no tools yet.</p>}
      {list !== null && list.rows.length > 0 && (
        <input
          type="search"
          className="perm-search"
          aria-label="Find a permission"
          placeholder="Find a permission"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      )}
      {searching && shown.length === 0 && <p>{`No permission matches "${term.trim()}".`}</p>}
      {shown.map(({ group, rows }) => (
        <PermissionGroup
          key={group.id}
          group={group}
          rows={rows}
          open={searching || openIds.has(group.id)}
          onToggle={() => toggle(group.id)}
          onSet={apply}
        />
      ))}
    </section>
  );
}
