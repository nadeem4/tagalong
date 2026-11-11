/**
 * One collapsible group of Home's Permissions: a header with the group's name, a one-line summary
 * of its modes and a flag when a risky tool is on Auto, then its tools in plain words, each with
 * an Off, Ask or Auto control. A risky tool asks for a Confirm before it goes to Auto.
 * Contains PermissionGroup and the mode helpers the panel reuses.
 */
import { useId, useState } from 'react';
import { Button } from '../controls/button';
import { ThreeWay, type ThreeWayOption } from '../controls/three-way';
import type { PermissionGroup as GroupInfo, PermissionRow } from '../host-bridge';
import { InfoPopover } from './info-popover';

export type Mode = PermissionRow['mode'];

/** What the brain lets this tool be: a person-only or self-asking tool is never Auto, and a
 * server tool (run by Anthropic, never gated) is never Ask. */
export function optionsFor(row: PermissionRow): ThreeWayOption[] {
  const options: ThreeWayOption[] = [{ value: 'off', label: 'Off' }];
  if (row.server_tool !== true) options.push({ value: 'ask', label: 'Ask' });
  if (!row.person_only && row.self_asks !== true) options.push({ value: 'auto', label: 'Auto' });
  return options;
}

/** A self-asking tool reports auto (its own ask is the gate); Home shows that as Ask. */
export function shownMode(row: PermissionRow): Mode {
  return row.self_asks === true && row.mode !== 'off' ? 'ask' : row.mode;
}

/** A tool that runs without asking once on Auto and can change things. */
const isRisky = (row: PermissionRow): boolean => row.locked && !row.person_only;

const MODE_WORD: Record<Mode, string> = { off: 'Off', ask: 'Ask', auto: 'Auto' };

/** "all Auto", or "2 Ask, 11 Auto"; a group of server tools starts "Off or Auto · ". */
function summarize(rows: PermissionRow[]): string {
  const counts: Record<Mode, number> = { off: 0, ask: 0, auto: 0 };
  for (const row of rows) counts[shownMode(row)] += 1;
  const used = (['off', 'ask', 'auto'] as const).filter((mode) => counts[mode] > 0);
  const [only] = used;
  const text =
    used.length === 1 && only
      ? `all ${MODE_WORD[only]}`
      : used.map((mode) => `${counts[mode]} ${MODE_WORD[mode]}`).join(', ');
  return rows.every((row) => row.server_tool === true) ? `Off or Auto · ${text}` : text;
}

/** App and browser groups say where they come from in the header; the rest explain themselves. */
const noteInHeader = (group: GroupInfo): boolean =>
  group.id.includes(':') || group.id === 'browser';

interface RowProps {
  row: PermissionRow;
  onSet: (name: string, mode: Mode) => void;
}

function PermissionRowItem({ row, onSet }: RowProps) {
  const labelId = useId();
  const [warning, setWarning] = useState(false);
  const controlId = `${labelId}-control`;
  const mode = shownMode(row);

  // Closing the warning hands focus back to the control that opened it.
  const closeWarning = (): void => {
    setWarning(false);
    document
      .getElementById(controlId)
      ?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
      ?.focus();
  };
  const choose = (next: Mode): void => {
    // A locked tool runs without asking once on Auto, so say so first.
    if (row.locked && next === 'auto') {
      setWarning(true);
      return;
    }
    onSet(row.name, next);
  };

  const classes = ['perm-row'];
  if (!row.online) classes.push('perm-row--offline');
  if (row.mode === 'off') classes.push('perm-row--off');
  if (isRisky(row) && mode === 'auto') classes.push('perm-row--risky-auto');

  return (
    <li className={classes.join(' ')}>
      <span className="perm-row__body">
        <span className="perm-row__head">
          <span id={labelId} className="perm-row__name">
            {row.title}
          </span>
          {row.info !== '' && <InfoPopover label={row.title} text={row.info} />}
          {(row.person_only || row.self_asks === true) && (
            <span className="perm-chip perm-chip--quiet">Always asks</span>
          )}
          {isRisky(row) && <span className="perm-chip perm-chip--warn">Risky</span>}
          {!row.online && <span className="perm-chip perm-chip--quiet">Not connected</span>}
        </span>
        <span className="perm-row__text">{row.line}</span>
      </span>
      <span id={controlId}>
        <ThreeWay
          labelledBy={labelId}
          value={mode}
          options={optionsFor(row)}
          describedBy={warning ? `${labelId}-warning` : undefined}
          onChange={(next) => choose(next as Mode)}
        />
      </span>
      {warning && (
        <div
          id={`${labelId}-warning`}
          role="alert"
          className="perm-row__warning"
          onKeyDown={(event) => {
            if (event.key === 'Escape') closeWarning();
          }}
        >
          <p>
            This is a risky action. If you turn it to Auto, Scout will no longer ask you before
            doing it.
          </p>
          <Button
            variant="primary"
            onClick={() => {
              closeWarning();
              onSet(row.name, 'auto');
            }}
          >
            Confirm
          </Button>
          <Button variant="quiet" autoFocus onClick={closeWarning}>
            Cancel
          </Button>
        </div>
      )}
    </li>
  );
}

interface GroupProps {
  group: GroupInfo;
  rows: PermissionRow[];
  open: boolean;
  onToggle: () => void;
  onSet: (name: string, mode: Mode) => void;
}

/** `rows` are the ones to list; the header always summarises them all unless the panel narrowed
 * them to a search, in which case the summary says what is shown. */
export function PermissionGroup({ group, rows, open, onToggle, onSet }: GroupProps) {
  const bodyId = useId();
  const risky = rows.filter((row) => isRisky(row) && shownMode(row) === 'auto').length;
  const inHeader = noteInHeader(group);
  return (
    <div className="perm-group2">
      <button
        type="button"
        className="perm-group2__head"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="perm-group2__chev" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        <span className="perm-group2__name">{group.title}</span>
        {inHeader && <span className="perm-chip perm-chip--quiet">{group.note}</span>}
        {risky > 0 && (
          <span className="perm-chip perm-chip--warn">
            {risky} risky {risky === 1 ? 'tool' : 'tools'} on Auto
          </span>
        )}
        <span className="perm-group2__sum">
          {rows.length} · {summarize(rows)}
        </span>
      </button>
      <div id={bodyId} hidden={!open}>
        {open && (
          <>
            {!inHeader && <p className="perm-group2__note">{group.note}</p>}
            <ul className="perm-list">
              {rows.map((row) => (
                <PermissionRowItem key={row.name} row={row} onSet={onSet} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
