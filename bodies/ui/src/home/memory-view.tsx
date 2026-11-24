/**
 * Home's "What Scout remembers" page: a summary card (the portrait, the years it covers and
 * where it was read), the facts as a year-by-year timeline, and the preferences and
 * conversation summaries as a flat list, each with Delete. Facts another AI tool added carry a
 * source filter, and one tool's can be deleted together. Contains MemoryView.
 */

import { useCallback, useEffect, useState } from 'react';
import { buildTimeline, memorySourceLabel } from '../shapes';
import type { MemoryEntry } from '../shapes';
import { useHostBridge } from '../host-bridge';
import { Button } from '../controls/button';
import { KnowMeFlow } from '../know-me/know-me-flow';
import { MemoryTimeline, deleteLabel, sourceLabel } from './memory-timeline';
import { themeTokens as t, themedColor, typeCss } from '../theme/tokens';

const KIND_LABELS: Record<MemoryEntry['kind'], string> = {
  fact: 'Fact',
  preference: 'Preference',
  summary: 'Conversation summary',
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

const CSS = `
/* One grid for the list, rows on its subgrid: every row's text starts at the same left edge. */
.memory-list {
  list-style: none; margin: 0; padding: 0; display: grid;
  grid-template-columns: max-content minmax(0, 1fr) auto auto;
}
.memory-row {
  display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: start;
  gap: ${t.space.lg}px; padding: ${t.space.lg}px 0; border-top: 1px solid ${themedColor.panelLine};
  color: ${themedColor.panelText};
}
.memory-row__text { ${typeCss('bodyLead')}; overflow-wrap: anywhere; min-width: 0; }
.memory-row__date { padding-top: 3px; ${typeCss('small')}; color: ${themedColor.panelMuted}; }
.memory-portrait p { margin: 0; max-width: 62ch; ${typeCss('bodyLead')}; overflow-wrap: anywhere; }
.memory-portrait p + p { margin-top: ${t.space.lg}px; }
.memory-head-actions { margin-top: ${t.space.md}px; }
.memory-row .tg-chip { justify-self: start; white-space: nowrap; }
.memory-covered { margin-top: ${t.space.lg}px; ${typeCss('small')}; color: ${themedColor.panelMuted}; }
.memory-covered p { margin: 0; }
.memory-filter { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: ${t.space.md}px; margin: ${t.space.md}px 0; }
.memory-filter + .dv-confirm { margin-top: 0; }
.memory-from { display: flex; align-items: center; justify-content: space-between; gap: ${t.space.lg}px; margin: 0 0 ${t.space.md}px; ${typeCss('small')}; color: ${themedColor.panelMuted}; }
`;

const OWN = 'own';
const own = (fact: MemoryEntry): boolean => !fact.source || fact.source === 'chat';
const originOf = (fact: MemoryEntry): string => (own(fact) ? OWN : fact.source!);

/** The sources a run of facts was read from, in the order first seen; chat is not a source. */
function sourcesOf(facts: MemoryEntry[]): string[] {
  const seen = new Set<string>();
  for (const f of facts) if (f.source && f.source !== 'chat') seen.add(sourceLabel(f.source));
  return [...seen];
}

/**
 * Home's "What Scout remembers": every memory Scout keeps about the person. Facts sit in the
 * timeline; preferences and conversation summaries stay a flat list, newest first, with the
 * day they were saved. Each one can be deleted, for good.
 */
export function MemoryView({ name }: { name: string }) {
  const bridge = useHostBridge();
  const [memories, setMemories] = useState<MemoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [knowOpen, setKnowOpen] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  const [confirmForget, setConfirmForget] = useState(false);

  const refresh = useCallback(() => {
    // The portrait is a bonus: a failure to read it leaves the list as it was.
    bridge.getPortrait().then(setPortrait, () => undefined);
    bridge
      .listMemories()
      .then((latest) => {
        setFailed(false);
        setMemories(latest);
      })
      .catch((error: unknown) => {
        console.error('could not list what Scout remembers', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    // The brain says so when Scout remembers or forgets something mid-turn.
    return bridge.onBrainChanged((what) => {
      if (what === 'memory') refresh();
    });
  }, [bridge, refresh]);

  const remove = (id: string): void => {
    void bridge
      .deleteMemory(id)
      .then(() => setMemories((current) => (current ?? []).filter((memory) => memory.id !== id)))
      .catch((error: unknown) => console.error('could not delete a memory', error));
  };

  const forgetFrom = (source: string): void => {
    void bridge
      .forgetMemoriesFrom(source)
      .then(() => {
        setConfirmForget(false);
        setOrigin(null);
        refresh();
      })
      .catch((error: unknown) => console.error('could not delete a tool memories', error));
  };

  const allFacts = (memories ?? []).filter((memory) => memory.kind === 'fact');
  const origins = [...new Set(allFacts.map(originOf))];
  const chosen = origin !== null && origins.includes(origin) ? origin : null;
  const facts = chosen === null ? allFacts : allFacts.filter((f) => originOf(f) === chosen);
  const chosenTool = chosen !== null && chosen !== OWN ? memorySourceLabel(chosen) : null;
  const others = (memories ?? []).filter((memory) => memory.kind !== 'fact');
  const { covered } = buildTimeline(facts);
  const sources = sourcesOf(facts);
  const coveredLines =
    covered !== null || sources.length > 0 ? (
      <div className="memory-covered">
        {covered !== null && <p>Years covered: {covered}</p>}
        {sources.length > 0 && <p>From {sources.join(', ')}</p>}
      </div>
    ) : null;
  const title = `What ${name} remembers`;
  return (
    <>
      <style>{CSS}</style>
      <div className="home-head">
        <h1 className="home-title">{title}</h1>
        <p>Kept until you delete them. Deleting one is for good.</p>
        {!knowOpen && (
          <div className="memory-head-actions">
            <Button variant="secondary" onClick={() => setKnowOpen(true)}>
              {portrait === null ? 'Get to know me' : 'Get to know me again'}
            </Button>
          </div>
        )}
      </div>
      {knowOpen && (
        <section className="tg-card" aria-label="Get to know me">
          <KnowMeFlow
            onDone={() => setKnowOpen(false)}
            onClose={() => setKnowOpen(false)}
            onFinished={refresh}
          />
        </section>
      )}
      {portrait !== null && (
        <section className="tg-card memory-portrait" aria-labelledby="memory-portrait-title">
          <h2 id="memory-portrait-title" className="tg-card__label">
            {name}’s portrait of you
          </h2>
          {portrait
            .split(/\n\s*\n/)
            .filter((paragraph) => paragraph.trim() !== '')
            .map((paragraph, i) => (
              <p key={i}>{paragraph.trim()}</p>
            ))}
          {coveredLines}
        </section>
      )}
      {facts.length > 0 && (
        <section className="tg-card" aria-label="Timeline">
          <h2 className="tg-card__label">Timeline</h2>
          {portrait === null && coveredLines}
          {origins.length > 1 && (
            <div className="memory-filter">
              <div className="apv-seg" role="group" aria-label="Filter memories">
                {[null, ...origins].map((item) => (
                  <button
                    key={item ?? 'all'}
                    type="button"
                    aria-pressed={chosen === item}
                    onClick={() => {
                      setOrigin(item);
                      setConfirmForget(false);
                    }}
                  >
                    {item === null ? 'Everything' : item === OWN ? 'From Scout' : sourceLabel(item)}
                    <span className="apv-seg__n">
                      {item === null
                        ? allFacts.length
                        : allFacts.filter((f) => originOf(f) === item).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {chosenTool !== null && !confirmForget && (
            <p className="memory-from">
              <span>
                {facts.length} {facts.length === 1 ? 'memory' : 'memories'} from {chosenTool}
              </span>
              <Button variant="secondary" onClick={() => setConfirmForget(true)}>
                Delete everything from this tool
              </Button>
            </p>
          )}
          {chosenTool !== null && confirmForget && (
            <div role="alert" className="dv-confirm">
              <span>
                <strong>
                  Delete all {facts.length} from {chosenTool}?
                </strong>{' '}
                {chosenTool} stays connected and can add new ones. This cannot be undone.
              </span>
              <Button variant="quiet" onClick={() => setConfirmForget(false)}>
                Keep them
              </Button>
              <Button variant="danger" onClick={() => forgetFrom(chosen!)}>
                Delete them
              </Button>
            </div>
          )}
          <MemoryTimeline entries={facts} onDelete={remove} />
        </section>
      )}
      {(memories === null || memories.length === 0 || others.length > 0) && (
        <section className="tg-card" aria-label="Memories">
          <h2 className="tg-card__label">Memories</h2>
          {failed && memories === null && (
            <p role="alert">Tagalong could not read these memories. Reopen Home to try again.</p>
          )}
          {memories !== null && memories.length === 0 && (
            <p>{name} doesn’t remember anything yet.</p>
          )}
          {others.length > 0 && (
            <ul aria-label={title} className="memory-list">
              {others.map((memory) => (
                <li key={memory.id} className="memory-row">
                  <span className="tg-chip">{KIND_LABELS[memory.kind]}</span>
                  <span className="memory-row__text">{memory.text}</span>
                  <span className="memory-row__date home-time">{day(memory.createdAt)}</span>
                  <Button
                    variant="quiet"
                    aria-label={deleteLabel(memory.text)}
                    onClick={() => remove(memory.id)}
                  >
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
