/**
 * Home's decisions page: the experience log in words. Every turn, job, routine run and
 * check-in, silent ones included, with why Scout woke, what it was shown, each tool it used,
 * what it decided and said, and what you did about it. Contains DecisionsView.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import type { Episode, EpisodeEvent, ExperienceGetResult } from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import { themeTokens as t } from '../theme/tokens';
import { changesActivity } from './activity-view';

/** How many episodes one page holds. */
const PAGE = 30;

/** Why the mind woke, as a person would say it. Unknown reasons show as recorded. */
const WHY: Record<string, string> = {
  asked: 'You asked',
  voice: 'You asked out loud',
  job: 'Background job',
  routine: 'Routine',
  launch: 'Tagalong opened',
  back: 'You came back',
  settled: 'You settled on a window',
  trouble: 'An error on screen',
  'long-stretch': 'A long stretch',
  finished: 'Work finished',
};

/** What the person did about it. */
const DID: Record<string, string> = {
  'not-now': 'You said Not now',
  accepted: 'You took the offer',
  sent: 'You sent the hand-off',
  dismissed: 'You dismissed the hand-off',
};

function headline(episode: Episode, who: string): string {
  switch (episode.decision) {
    case undefined:
      return `${who} is thinking`;
    case 'answered':
      return episode.mode === 'turn'
        ? `${who} answered`
        : episode.mode === 'job'
          ? `${who} finished a background job`
          : `${who} ran a routine`;
    case 'stopped':
      return `${who} was stopped`;
    case 'error':
      return `${who} could not answer`;
    case 'quiet':
      return `${who} stayed quiet`;
    case 'spoke':
      return `${who} spoke up`;
    case 'offered':
      return `${who} offered to help`;
    case 'no-answer':
      return `${who}’s mind did not answer`;
    case 'held':
      return `${who} held a line back`;
  }
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function tokens(episode: Episode): string | undefined {
  if (episode.inputTokens === undefined && episode.outputTokens === undefined) return undefined;
  const total = (episode.inputTokens ?? 0) + (episode.outputTokens ?? 0);
  return `${total.toLocaleString('en-US')} tokens`;
}

/**
 * Home's decisions view: why Scout did what it did. Read from the engine's experience log with
 * `listExperience`, re-read whenever a turn or a line is reported; an episode's tool calls and
 * outcomes are read when it is opened.
 */
export function DecisionsView({ name }: { name: string }) {
  const bridge = useHostBridge();
  const [page, setPage] = useState<{ episodes: Episode[]; next?: string | undefined } | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const supported = bridge.listExperience !== undefined;

  const refresh = useCallback(() => {
    const list = bridge.listExperience;
    if (list === undefined) return;
    list
      .call(bridge, { limit: PAGE })
      .then((latest) => {
        setFailed(false);
        setPage((current) => {
          // Older pages already read stay below the fresh first page.
          if (current === null || current.episodes.length <= PAGE) return latest;
          const fresh = new Set(latest.episodes.map((episode) => episode.id));
          const older = current.episodes.filter((episode) => !fresh.has(episode.id));
          return {
            episodes: [...latest.episodes, ...older],
            ...(current.next === undefined ? {} : { next: current.next }),
          };
        });
      })
      .catch((error: unknown) => {
        console.error('could not list decisions', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onTurnEvent((event) => {
      if (changesActivity(event) || event.type === 'pet.remark') refresh();
    });
  }, [bridge, refresh]);

  const older = (): void => {
    const list = bridge.listExperience;
    const before = page?.next;
    if (list === undefined || before === undefined) return;
    list
      .call(bridge, { before, limit: PAGE })
      .then((more) =>
        setPage((current) => ({
          episodes: [...(current?.episodes ?? []), ...more.episodes],
          ...(more.next === undefined ? {} : { next: more.next }),
        })),
      )
      .catch((error: unknown) => console.error('could not list older decisions', error));
  };

  const clear = (): void => {
    setConfirming(false);
    void bridge
      .clearExperience?.()
      .then(() => {
        setOpen(null);
        setPage({ episodes: [] });
      })
      .catch((error: unknown) => console.error('could not delete the decisions', error));
  };

  if (!supported) return <Note>Decisions are not available here.</Note>;
  if (failed && page === null) {
    return <Note>Tagalong could not read {name}’s decisions. Reopen Home to try again.</Note>;
  }
  if (page === null) return <Note>Reading {name}’s decisions…</Note>;
  if (page.episodes.length === 0) {
    return (
      <Note>
        Every time {name} decides something, answering you, speaking up or staying quiet, it shows
        up here: why it woke, what it was shown, the tools it used and what you did about it. Kept
        for 30 days, on this computer. Screen text and window titles are never kept.
      </Note>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {bridge.clearExperience !== undefined && (
        <span
          className="home-danger"
          style={{ alignSelf: 'flex-end', padding: `${t.space.lg}px ${t.space.xxl}px 0` }}
        >
          {confirming ? (
            <>
              <button type="button" className="tg-btn-quiet" onClick={clear}>
                Delete all for good
              </button>
              <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(false)}>
                Keep them
              </button>
            </>
          ) : (
            <button type="button" className="tg-btn-quiet" onClick={() => setConfirming(true)}>
              Delete all
            </button>
          )}
        </span>
      )}
      <ul aria-label="Decisions" className="home-activity">
        {page.episodes.map((episode) => (
          <Row
            key={episode.id}
            episode={episode}
            name={name}
            open={open === episode.id}
            onToggle={() => setOpen(open === episode.id ? null : episode.id)}
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

function Row({
  episode,
  name,
  open,
  onToggle,
}: {
  episode: Episode;
  name: string;
  open: boolean;
  onToggle: () => void;
}) {
  const detailId = useId();
  const title = headline(episode, name);
  const meta = [WHY[episode.trigger] ?? episode.trigger, episode.model, tokens(episode)]
    .concat(time(episode.startedAt))
    .filter((part): part is string => part !== undefined);
  const preview = episode.said ?? episode.input;
  return (
    <li>
      <button
        type="button"
        className="home-entry"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={onToggle}
      >
        <span className="home-entry__body">
          <span className="home-entry__title">{title}</span>
          <span className="home-entry__meta">{meta.join(' · ')}</span>
          {preview !== undefined && <span className="home-entry__preview">{preview}</span>}
        </span>
      </button>
      {open && (
        <section id={detailId} aria-label={title} className="home-thread">
          <Detail id={episode.id} name={name} />
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

function step(event: EpisodeEvent): string {
  const lines = [event.name];
  if (event.input !== undefined && event.input !== '{}') lines[0] += ` ${event.input}`;
  if (event.result !== undefined) {
    lines.push(event.ok === false ? `failed: ${event.result}` : event.result);
  } else if (event.ok === false) {
    lines.push('failed');
  }
  return lines.join('\n');
}

/** One episode, read when opened, so the list stays light. */
function Detail({ id, name: who }: { id: string; name: string }) {
  const bridge = useHostBridge();
  const [read, setRead] = useState<ExperienceGetResult | 'loading' | 'failed'>('loading');
  const supported = bridge.getExperience !== undefined;

  useEffect(() => {
    const get = bridge.getExperience;
    if (get === undefined) return;
    get
      .call(bridge, id)
      .then(setRead)
      .catch((error: unknown) => {
        console.error('could not read a decision', error);
        setRead('failed');
      });
  }, [bridge, id]);

  if (supported && read === 'loading') return <Said who="Reading" text="…" />;
  if (!supported || read === 'loading' || read === 'failed' || read === null) {
    return <Said who="Gone" text="This decision could not be read; it may have been deleted." />;
  }
  const { episode, events } = read;
  const steps = events.filter((event) => event.kind === 'step');
  const outcomes = events.filter((event) => event.kind === 'outcome');
  const quiet = episode.decision === 'quiet' || episode.decision === 'no-answer';
  return (
    <>
      <Said who="Why it woke" text={WHY[episode.trigger] ?? episode.trigger} />
      {episode.input !== undefined && <Said who="What it was shown" text={episode.input} />}
      {steps.map((event, index) => (
        <Said key={index} who={`Tool ${index + 1}`} text={step(event)} />
      ))}
      {episode.said !== undefined && (
        <Said
          who={episode.decision === 'held' ? `What ${who} wrote, never shown` : `What ${who} said`}
          text={episode.said}
        />
      )}
      {quiet && <Said who={`What ${who} said`} text="Nothing." />}
      {episode.note !== undefined && (
        <Said who={episode.decision === 'offered' ? 'Offered' : 'Note'} text={episode.note} />
      )}
      {outcomes.map((event, index) => (
        <Said key={`o${index}`} who="What you did" text={DID[event.name] ?? event.name} />
      ))}
    </>
  );
}
