/**
 * Home's "What Scout remembers" page: Scout's facts, preferences and conversation summaries,
 * newest first, each with Delete. Above the list sit Scout's portrait of the person and the
 * Get to know me button that writes it. Contains MemoryView.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MemoryEntry } from '../shapes';
import { useHostBridge } from '../host-bridge';
import { Button } from '../controls/button';
import { KnowMeFlow } from '../know-me/know-me-flow';
import { themeTokens as t, typeCss } from '../theme/tokens';

const KIND_LABELS: Record<MemoryEntry['kind'], string> = {
  fact: 'Fact',
  preference: 'Preference',
  summary: 'Conversation summary',
};

/** A delete button's name: the memory's start, so a long summary stays a short name. */
function deleteLabel(text: string): string {
  return `Delete: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
}

const SOURCE_LABELS: Record<string, string> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  web: 'The web',
};
const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** A fact's small line: its tag, where it was read, and whether it is only used when asked. */
function provenance(memory: MemoryEntry): string[] {
  const parts: string[] = [];
  if (memory.tag) parts.push(cap(memory.tag));
  if (memory.source && memory.source !== 'chat') {
    parts.push(SOURCE_LABELS[memory.source] ?? cap(memory.source));
  }
  if (memory.visibility === 'asked') parts.push('only if asked');
  return parts;
}

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
  gap: ${t.space.lg}px; padding: ${t.space.lg}px 0; border-top: 1px solid ${t.color.panelLine};
  color: ${t.color.panelText};
}
.memory-row__text { ${typeCss('bodyLead')}; overflow-wrap: anywhere; min-width: 0; }
.memory-row__date { padding-top: 3px; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.memory-row__meta { display: block; margin-top: ${t.space.xxs}px; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.memory-portrait p { margin: 0; max-width: 62ch; ${typeCss('bodyLead')}; overflow-wrap: anywhere; }
.memory-portrait p + p { margin-top: ${t.space.lg}px; }
.memory-head-actions { margin-top: ${t.space.md}px; }
.memory-row .tg-chip { justify-self: start; white-space: nowrap; }
`;

/**
 * Home's "What Scout remembers": every memory Scout keeps about the person, newest first,
 * with its kind and the day it was saved. Each one can be deleted, for good.
 */
export function MemoryView({ name }: { name: string }) {
  const bridge = useHostBridge();
  const [memories, setMemories] = useState<MemoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [portrait, setPortrait] = useState<string | null>(null);
  const [knowOpen, setKnowOpen] = useState(false);

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
          <KnowMeFlow onDone={() => setKnowOpen(false)} onFinished={refresh} />
          <div className="memory-head-actions">
            <Button variant="quiet" onClick={() => setKnowOpen(false)}>
              Close
            </Button>
          </div>
        </section>
      )}
      {portrait !== null && (
        <section className="tg-card memory-portrait" aria-label="Scout’s portrait of you">
          <h2 className="tg-card__label">{name}’s portrait of you</h2>
          {portrait
            .split(/\n\s*\n/)
            .filter((paragraph) => paragraph.trim() !== '')
            .map((paragraph, i) => (
              <p key={i}>{paragraph.trim()}</p>
            ))}
        </section>
      )}
      <section className="tg-card" aria-label="Memories">
        <h2 className="tg-card__label">Memories</h2>
        {failed && memories === null && (
          <p role="alert">Tagalong could not read these memories. Reopen Home to try again.</p>
        )}
        {memories !== null && memories.length === 0 && <p>{name} doesn’t remember anything yet.</p>}
        {memories !== null && memories.length > 0 && (
          <ul aria-label={title} className="memory-list">
            {memories.map((memory) => (
              <li key={memory.id} className="memory-row">
                <span className="tg-chip">{KIND_LABELS[memory.kind]}</span>
                <span className="memory-row__text">
                  {memory.text}
                  {provenance(memory).length > 0 && (
                    <span className="memory-row__meta">{provenance(memory).join(' · ')}</span>
                  )}
                </span>
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
    </>
  );
}
