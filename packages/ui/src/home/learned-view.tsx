/**
 * Home's What Scout learned: Scout's own notes (the Self), one page at a time, with every
 * change, who made it and why, each one's text, an Undo on the newest, Accept and Reject on
 * each proposed change, and the person's own edits. Contains LearnedView.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  SelfAuthor,
  SelfGetResult,
  SelfListResult,
  SelfNight,
  SelfVersion,
} from '@tagalong/protocol';
import { useHostBridge } from '../host-bridge';
import { themeTokens as t } from '../theme/tokens';

function who(author: SelfAuthor, name: string): string {
  switch (author) {
    case 'person':
      return 'You';
    case 'scout':
      return `${name}, in a conversation`;
    case 'sleep':
      return `${name}, while sleeping`;
  }
}

function nightLine(night: SelfNight | undefined, name: string): string {
  if (night === undefined) {
    return `${name} has not slept yet. Once a day, while you are away, ${name} reads back what it did and what you made of it, and proposes changes to these pages for you to accept or reject.`;
  }
  if (night.state === 'error') {
    return `Last sleep failed: ${night.note ?? 'no reason given.'}`;
  }
  return `Last slept ${when(night.startedAt)}: ${night.note ?? (night.state === 'running' ? 'still sleeping.' : '')}`;
}

function stateLabel(version: SelfVersion): string {
  switch (version.state) {
    case 'proposed':
      return ' · Proposed';
    case 'accepted':
      return ' · Accepted';
    case 'rejected':
      return ' · Rejected';
    case 'applied':
      return version.acceptedBy === 'person' ? ' · accepted by you' : '';
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function when(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * What Scout learned: the pages on the left, the open page on the right as a text box the
 * person can edit, and its changes below. Read with `listSelf` and `getSelf`; edits go
 * through `writeSelf`, `undoSelf`, `acceptSelf` and `rejectSelf`, and the page is read again
 * after each. A failed call says so beside Save.
 */
export function LearnedView({ name }: { name: string }) {
  const bridge = useHostBridge();
  const [list, setList] = useState<SelfListResult | null>(null);
  const [open, setOpen] = useState('you.md');
  const [page, setPage] = useState<NonNullable<SelfGetResult> | null>(null);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [shown, setShown] = useState<ReadonlySet<number>>(new Set());
  const supported = bridge.listSelf !== undefined && bridge.getSelf !== undefined;

  const reload = useCallback(
    (path: string) => {
      void bridge
        .listSelf?.()
        .then(setList)
        .catch((error: unknown) => console.error('could not list the notes', error));
      void bridge
        .getSelf?.(path)
        .then((read) => {
          setPage(read);
          setDraft(read?.text ?? '');
        })
        .catch((error: unknown) => console.error('could not read a page', error));
    },
    [bridge],
  );

  useEffect(() => {
    reload(open);
  }, [reload, open]);

  if (!supported) return <Note>What {name} learned is not available here.</Note>;
  if (list === null) return <Note>Reading {name}’s notes…</Note>;

  /** Runs one change, then says how it went and reads the page again. */
  const run = (
    call: Promise<{ ok: boolean; reason?: string; note?: string }> | undefined,
    done: string,
    failed: string,
  ): void => {
    void call
      ?.then((result) => {
        setMessage(
          result.ok ? (result.note ?? done) : `${failed}: ${result.reason ?? 'no reason given.'}`,
        );
        if (result.ok) reload(open);
      })
      .catch((error: unknown) => setMessage(`${failed}: ${reasonOf(error)}`));
  };
  const save = (): void => run(bridge.writeSelf?.(open, draft), 'Saved.', 'Not saved');
  const undo = (id: number): void => run(bridge.undoSelf?.(id), 'Undone.', 'Not undone');
  const accept = (id: number): void => run(bridge.acceptSelf?.(id), 'Accepted.', 'Not accepted');
  const reject = (id: number): void => run(bridge.rejectSelf?.(id), 'Rejected.', 'Not rejected');
  const toggle = (id: number): void =>
    setShown((before) => {
      const next = new Set(before);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Only the newest applied change can be undone; the ones before it are read-only.
  const newest = page?.versions.find((version) => version.state === 'applied')?.id;

  return (
    <div className="home-learned">
      <p className="home-learned__night">{nightLine(list.nights[0], name)}</p>
      <div className="home-learned__body">
        <ul aria-label="Pages" className="home-learned__pages">
          {list.pages.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className="home-learned__page"
                aria-pressed={entry.path === open}
                onClick={() => {
                  setMessage(null);
                  setOpen(entry.path);
                }}
              >
                {entry.path}
              </button>
              {entry.proposals > 0 && (
                <span className="home-learned__waiting">{entry.proposals} to review</span>
              )}
            </li>
          ))}
        </ul>
        <section className="home-learned__open" aria-label={open}>
          <textarea
            aria-label={open}
            className="home-learned__text"
            value={draft}
            placeholder={`${name} has not written ${open} yet.`}
            onChange={(event) => {
              setMessage(null);
              setDraft(event.target.value);
            }}
          />
          <div className="home-learned__actions">
            <button
              type="button"
              className="home-quiet"
              disabled={page === null || draft === page.text}
              onClick={save}
            >
              Save
            </button>
            {message !== null && <span role="status">{message}</span>}
          </div>
          {page !== null && page.versions.length > 0 && (
            <ul aria-label="Changes" className="home-learned__changes">
              {page.versions.map((version) => {
                const proposed = version.state === 'proposed';
                return (
                  <li key={version.id}>
                    <span className="home-said__who">
                      {who(version.author, name)} · {when(version.at)}
                      {stateLabel(version)}
                    </span>
                    <span>{version.why}</span>
                    {(proposed || shown.has(version.id)) && (
                      <pre className="home-learned__version">
                        {version.text === '' ? '(empty)' : version.text}
                      </pre>
                    )}
                    <div className="home-learned__actions">
                      {proposed ? (
                        <>
                          <button
                            type="button"
                            className="home-quiet"
                            onClick={() => accept(version.id)}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="home-quiet"
                            onClick={() => reject(version.id)}
                          >
                            Reject
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="home-quiet"
                          onClick={() => toggle(version.id)}
                        >
                          {shown.has(version.id) ? 'Hide text' : 'Show text'}
                        </button>
                      )}
                      {version.id === newest && (
                        <button
                          type="button"
                          className="home-quiet"
                          onClick={() => undo(version.id)}
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
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
