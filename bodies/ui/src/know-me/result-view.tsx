/**
 * The result of get to know me, in two steps: Scout's portrait of the person first, then the
 * facts it is based on, each with where it came from. Shared by the tour and Home. Contains
 * ResultView and gapsFrom.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '../controls/button';
import { ScoutMark } from '../scout-mark';
import type { KnowMeStatus, MemoryEntry } from '../shapes';
import { KNOW_ME_CSS } from './know-me-styles';

const SOURCE_LABELS: Record<string, string> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  web: 'The web',
};
/** The tags the brain writes, in the order a person thinks of them; any other tag follows. */
const TAG_ORDER = ['work', 'skills', 'projects', 'interests', 'personal'];

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);
const sourceLabel = (source: string | undefined): string =>
  source === undefined ? '' : (SOURCE_LABELS[source] ?? cap(source));
const tagOf = (fact: MemoryEntry): string => fact.tag ?? 'other';

/** One line per gap the run reported; the portrait's own gap needs no source name. */
export function gapsFrom(status: KnowMeStatus | null): string[] {
  return (status?.sources ?? [])
    .filter((row) => row.gap !== undefined && row.gap !== '')
    .map((row) => (row.name === 'portrait' ? row.gap! : `${row.name}: ${row.gap!}`));
}

function tagsOf(facts: MemoryEntry[]): string[] {
  const present = new Set(facts.map(tagOf));
  const known = TAG_ORDER.filter((tag) => present.has(tag));
  return [...known, ...[...present].filter((tag) => !TAG_ORDER.includes(tag)).sort()];
}

interface ResultViewProps {
  /** Scout's portrait, paragraphs split by a blank line; null when none could be written. */
  portrait: string | null;
  gaps: string[];
  /** The facts read from the person's profiles (not the ones told in chat). */
  facts: MemoryEntry[];
  onDone(): void;
}

export function ResultView({ portrait, gaps, facts, onDone }: ResultViewProps) {
  const [step, setStep] = useState<'portrait' | 'facts'>('portrait');
  const [tag, setTag] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // Moving between steps replaces the content under the keyboard, so the new heading takes focus.
  useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);

  const count = `${facts.length} ${facts.length === 1 ? 'fact' : 'facts'}`;

  if (step === 'facts') {
    const shown = tag === null ? facts : facts.filter((fact) => tagOf(fact) === tag);
    return (
      <div className="know">
        <style>{KNOW_ME_CSS}</style>
        <h2 className="know__title" tabIndex={-1} ref={heading}>
          What I found
        </h2>
        <div className="know__filters" role="group" aria-label="Filter by kind">
          <button
            type="button"
            className="know__filter"
            aria-pressed={tag === null}
            onClick={() => setTag(null)}
          >
            All {facts.length}
          </button>
          {tagsOf(facts).map((name) => (
            <button
              key={name}
              type="button"
              className="know__filter"
              aria-pressed={tag === name}
              onClick={() => setTag(name)}
            >
              {cap(name)} {facts.filter((fact) => tagOf(fact) === name).length}
            </button>
          ))}
        </div>
        <ul className="know__facts" aria-label="Facts">
          {shown.map((fact) => (
            <li key={fact.id} className="know__fact">
              <span className="know__fact-text">
                {fact.text}
                {fact.evidence && <span className="know__quote">“{fact.evidence}”</span>}
              </span>
              <span className="know__meta">
                {fact.visibility === 'asked' && (
                  <span className="know__chip know__chip--asked">only if asked</span>
                )}
                {fact.tag && <span className="know__chip">{cap(fact.tag)}</span>}
                {fact.source && <span className="know__chip">{sourceLabel(fact.source)}</span>}
              </span>
            </li>
          ))}
        </ul>
        <div className="know__actions">
          <Button variant="secondary" onClick={() => setStep('portrait')}>
            Back to portrait
          </Button>
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="know">
      <style>{KNOW_ME_CSS}</style>
      <div className="know__head">
        <ScoutMark size={44} />
        <div>
          <h2 className="know__title" tabIndex={-1} ref={heading}>
            Here&apos;s who I think you are
          </h2>
          {portrait !== null && <p className="know__sub">Built from {count}.</p>}
        </div>
      </div>
      <div className="know__portrait">
        {portrait === null ? (
          <p className="know__none">I did not find enough to write a portrait.</p>
        ) : (
          portrait
            .split(/\n\s*\n/)
            .filter((paragraph) => paragraph.trim() !== '')
            .map((paragraph, i) => <p key={i}>{paragraph.trim()}</p>)
        )}
      </div>
      {gaps.length > 0 && (
        <ul className="know__gaps" aria-label="What I could not read">
          {gaps.map((gap, i) => (
            <li key={i}>{gap}</li>
          ))}
        </ul>
      )}
      <div className="know__actions">
        <Button variant="primary" onClick={onDone}>
          Looks right
        </Button>
        {facts.length > 0 && (
          <Button variant="secondary" onClick={() => setStep('facts')}>
            What&apos;s this based on? ({count})
          </Button>
        )}
      </div>
    </div>
  );
}
