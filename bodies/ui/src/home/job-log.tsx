/**
 * The job page's read-only log: a dark, monospace list of what the expert did, one block per
 * step (command with a status glyph, its output, edits, reads, what it said, its plan, the end
 * line). Plain React with no terminal emulator, so nothing can be typed into it.
 * Contains JobLog.
 */
import { Fragment, type RefObject, type UIEvent } from 'react';
import type { JobActivityEntry } from '../host-bridge';
import { collapseCarriageReturns, parseAnsi } from './ansi';

const GLYPH: Record<string, string> = { done: '✓', failed: '✗', pending: '·', running: '◐' };
const GLYPH_NAME: Record<string, string> = { pending: 'waiting' };

/** Read at render: the spinner stays still when the person asked for reduced motion. */
function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function Glyph({ status }: { status: string | null }) {
  if (status === null) return null;
  return (
    <span
      className={`job-log__glyph job-log__glyph--${status}`}
      role="img"
      aria-label={GLYPH_NAME[status] ?? status}
      data-motion={status === 'running' && !reducedMotion() ? 'on' : 'off'}
    >
      {GLYPH[status] ?? '·'}
    </span>
  );
}

function Output({ text }: { text: string }) {
  return (
    <pre className="job-log__out">
      {parseAnsi(collapseCarriageReturns(text)).map((span, i) => (
        <span
          key={i}
          className={[span.color && `ansi-${span.color}`, span.bold && 'ansi-bold']
            .filter(Boolean)
            .join(' ')}
        >
          {span.text}
        </span>
      ))}
    </pre>
  );
}

function elapsed(at: string, now: number): string {
  return `running, ${Math.max(0, Math.floor((now - Date.parse(at)) / 1000))} s`;
}

export function JobLog({
  entries,
  now,
  logRef,
  onScroll,
}: {
  entries: JobActivityEntry[];
  now: number;
  logRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const withOutput = new Set(entries.filter((e) => e.kind === 'output').map((e) => e.step));
  return (
    <div
      ref={logRef}
      className="job-log"
      role="log"
      aria-label="Job log"
      aria-live="off"
      tabIndex={0}
      onScroll={onScroll}
    >
      {entries.map((e) => {
        switch (e.kind) {
          case 'command': {
            const waiting = e.status === 'running' && !withOutput.has(e.step);
            return (
              <Fragment key={e.seq}>
                <div className="job-log__line job-log__cmd">
                  <Glyph status={e.status} />
                  <span>{`$ ${e.text}`}</span>
                  {e.status === 'running' && (
                    <span className="job-log__meta">{elapsed(e.at, now)}</span>
                  )}
                </div>
                {waiting && (
                  <div className="job-log__note">output appears when the command finishes</div>
                )}
              </Fragment>
            );
          }
          case 'output':
            return <Output key={e.seq} text={e.text} />;
          case 'edit':
            return (
              <div key={e.seq} className="job-log__line job-log__edit">
                <Glyph status={e.status} />
                <span>{e.text}</span>
              </div>
            );
          case 'say':
            return (
              <div key={e.seq} className="job-log__say">
                {e.text.split('\n').map((line, i) => (
                  <div key={i}>{`# ${line}`}</div>
                ))}
              </div>
            );
          case 'plan':
            return (
              <pre key={e.seq} className="job-log__plan">
                {e.text}
              </pre>
            );
          case 'end':
            return (
              <div key={e.seq} className="job-log__line job-log__end">
                {e.text}
              </div>
            );
          default:
            // read, search, other and the "[older steps dropped]" marker
            return (
              <div key={e.seq} className="job-log__line job-log__quiet">
                <Glyph status={e.status} />
                <span>{e.text}</span>
              </div>
            );
        }
      })}
    </div>
  );
}
