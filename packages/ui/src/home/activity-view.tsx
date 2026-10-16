/**
 * Home's Activity page: what Scout did, newest first, each row opening its thread, paged
 * from the engine's record. Contains ActivityView and changesActivity (also used by the
 * Spend card to know when to read again).
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { ActivityEntry, ActivityState, Pet } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import type { TurnEvent } from '../host-bridge';
import { PixelSprite } from '../office/pixel-sprite';
import { characterFor } from '../office/sprites/characters';
import { officeTokens as t } from '../office/tokens';

/** How many entries one page holds. */
const PAGE = 30;

/** The events after which Activity (and the Spend card) read again. */
export function changesActivity(event: TurnEvent): boolean {
  switch (event.type) {
    case 'turn.started':
    case 'turn.completed':
    case 'turn.error':
    case 'handoff.finished':
    case 'routine.result':
      return true;
    default:
      return false;
  }
}

const WORDS: Record<ActivityState, string> = {
  running: 'Working',
  done: 'Done',
  error: 'Failed',
  stopped: 'Stopped',
};

function headline(entry: ActivityEntry, name: (petId: string) => string): string {
  const who = name(entry.petId);
  switch (entry.kind) {
    case 'expert':
      return `${who} handed off to ${entry.expertName ?? 'an expert'}`;
    case 'connector': {
      const app = entry.app ?? 'an app';
      if (entry.state === 'error') return `${who} could not reach ${app}`;
      if (entry.state === 'stopped') return `${who} did not change ${app}`;
      return entry.access === 'read' ? `${who} read ${app}` : `${who} changed ${app}`;
    }
    case 'routine': {
      const name = entry.text ?? 'A routine';
      if (entry.state === 'error') return `${name} did not run`;
      return entry.state === 'running' ? `${who} is running ${name}` : `${who} ran ${name}`;
    }
    case 'turn':
      return {
        running: `${who} is answering`,
        done: `${who} answered`,
        error: `${who} could not answer`,
        stopped: `${who} was stopped`,
      }[entry.state];
  }
}

function StateIcon({ state }: { state: ActivityState }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {state === 'running' && <path d="M8 2.5v3M8 10.5v3M2.5 8h3M10.5 8h3" />}
      {state === 'done' && <path d="M3 8.5l3 3 7-7" />}
      {state === 'error' && <path d="M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5v.01" />}
      {state === 'stopped' && <rect x="4" y="4" width="8" height="8" rx="1" />}
    </svg>
  );
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Home's activity view: what Scout did, newest first — every turn (who, the model, how many
 * calls), every hand-off to an expert, app call and routine run — each opening its thread
 * on click. Read from the engine's record with `listActivity`, re-read whenever a turn, a
 * hand-off or a routine run is reported.
 */
export function ActivityView({ pets }: { pets: readonly Pet[] }) {
  const bridge = useHostBridge();
  const [page, setPage] = useState<{ entries: ActivityEntry[]; next?: string | undefined } | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const supported = bridge.listActivity !== undefined;

  const refresh = useCallback(() => {
    const list = bridge.listActivity;
    if (list === undefined) return;
    list
      .call(bridge, { limit: PAGE })
      .then((latest) => {
        setFailed(false);
        setPage((current) => {
          // Older pages already read stay below the fresh first page.
          if (current === null || current.entries.length <= PAGE) return latest;
          const fresh = new Set(latest.entries.map((entry) => entry.id));
          const older = current.entries.filter((entry) => !fresh.has(entry.id));
          return {
            entries: [...latest.entries, ...older],
            ...(current.next === undefined ? {} : { next: current.next }),
          };
        });
      })
      .catch((error: unknown) => {
        console.error('could not list activity', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onTurnEvent((event) => {
      if (changesActivity(event)) refresh();
    });
  }, [bridge, refresh]);

  const older = (): void => {
    const list = bridge.listActivity;
    const before = page?.next;
    if (list === undefined || before === undefined) return;
    list
      .call(bridge, { before, limit: PAGE })
      .then((more) =>
        setPage((current) => ({
          entries: [...(current?.entries ?? []), ...more.entries],
          ...(more.next === undefined ? {} : { next: more.next }),
        })),
      )
      .catch((error: unknown) => console.error('could not list older activity', error));
  };

  const name = (petId: string): string => pets.find((pet) => pet.id === petId)?.name ?? petId;

  if (!supported) {
    return <Note>Activity is not available here.</Note>;
  }
  if (failed && page === null) {
    return <Note>Tagalong could not read Scout’s activity. Reopen Home to try again.</Note>;
  }
  if (page === null) return <Note>Reading Scout’s activity…</Note>;
  if (page.entries.length === 0) {
    return (
      <Note>
        Nothing yet. Every answer, every hand-off to an expert and every routine run shows up here
        as it happens.
      </Note>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <ul aria-label="Activity" className="home-activity">
        {page.entries.map((entry) => (
          <Entry
            key={entry.id}
            entry={entry}
            pets={pets}
            name={name}
            open={open === entry.id}
            onToggle={() => setOpen(open === entry.id ? null : entry.id)}
          />
        ))}
      </ul>
      {page.next !== undefined && (
        <button
          type="button"
          className="home-quiet"
          style={{ margin: `${t.space.lg}px ${t.space.xxl}px` }}
          onClick={older}
        >
          Show older
        </button>
      )}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: `${t.space.xxl}px`,
        maxWidth: t.size.emptyTextWidth + 2 * t.space.xxl,
        fontSize: t.fontSize.field,
        lineHeight: 1.5,
        color: t.color.panelMuted,
      }}
    >
      {children}
    </p>
  );
}

function Entry({
  entry,
  pets,
  name,
  open,
  onToggle,
}: {
  entry: ActivityEntry;
  pets: readonly Pet[];
  name: (petId: string) => string;
  open: boolean;
  onToggle: () => void;
}) {
  const threadId = useId();
  const title = headline(entry, name);
  const pet = pets.find((candidate) => candidate.id === entry.petId);
  const meta = [
    entry.tool,
    entry.model,
    entry.modelCalls === undefined
      ? undefined
      : `${entry.modelCalls} call${entry.modelCalls === 1 ? '' : 's'}`,
    time(entry.startedAt),
  ].filter((part): part is string => part !== undefined);
  return (
    <li>
      <button
        type="button"
        className="home-entry"
        aria-expanded={open}
        aria-controls={threadId}
        onClick={onToggle}
      >
        <span className="home-entry__tile">
          {pet !== undefined && (
            <PixelSprite sprite={characterFor(pet).sprite} scale={t.spriteScale.tile} />
          )}
        </span>
        <span className="home-entry__body">
          <span className="home-entry__title">{title}</span>
          <span className="home-entry__meta">
            <StateIcon state={entry.state} />
            {[WORDS[entry.state], ...meta].join(' · ')}
          </span>
          {entry.text !== undefined && <span className="home-entry__preview">{entry.text}</span>}
        </span>
      </button>
      {open && (
        <section id={threadId} aria-label={title} className="home-thread">
          <Thread entry={entry} name={name} />
        </section>
      )}
    </li>
  );
}

function Said({ who, text }: { who: string; text: string }) {
  return (
    <div className="home-said">
      <span className="home-said__who">{who}</span>
      <p>{text}</p>
    </div>
  );
}

function Thread({ entry, name }: { entry: ActivityEntry; name: (petId: string) => string }) {
  const who = name(entry.petId);
  const failure =
    entry.error === undefined ? null : <Said who="What went wrong" text={entry.error} />;
  switch (entry.kind) {
    case 'turn':
      return (
        <>
          {entry.text !== undefined && <Said who="Asked" text={entry.text} />}
          {entry.answer !== undefined && <Said who={`${who} answered`} text={entry.answer} />}
          {failure}
        </>
      );
    case 'expert': {
      const expert = entry.expertName ?? 'The expert';
      return (
        <>
          {entry.text !== undefined && <Said who={`What ${expert} was told`} text={entry.text} />}
          {entry.answer !== undefined && <Said who={`${expert} answered`} text={entry.answer} />}
          {entry.changedFiles !== undefined && (
            <Said who="Files changed" text={entry.changedFiles.join('\n')} />
          )}
          {failure}
        </>
      );
    }
    case 'connector':
      // What went in and what came back are never kept: only which tool, and how it ended.
      return (
        <>
          <Said
            who={entry.access === 'read' ? 'Tool (reads only)' : 'Tool (changes things)'}
            text={entry.tool ?? 'unknown'}
          />
          {entry.state === 'stopped' && (
            <Said who="Nothing changed" text="You said no, or did not answer in time." />
          )}
          {failure}
        </>
      );
  }
}
