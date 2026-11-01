/**
 * Home's "What Scout remembers" page: Scout's facts, preferences and conversation summaries,
 * newest first, each with Delete. Contains MemoryView.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MemoryEntry } from '../shapes';
import { useHostBridge } from '../host-bridge';
import { Button } from '../controls/button';
import { themeTokens as t } from '../theme/tokens';

const KIND_LABELS: Record<MemoryEntry['kind'], string> = {
  fact: 'Fact',
  preference: 'Preference',
  summary: 'Conversation summary',
};

/** A delete button's name: the memory's start, so a long summary stays a short name. */
function deleteLabel(text: string): string {
  return `Delete: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
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
.memory-row__text { font-size: ${t.fontSize.field}px; overflow-wrap: anywhere; min-width: 0; }
.memory-row__date { padding-top: 3px; font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
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

  const refresh = useCallback(() => {
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
      </div>
      <section className="home-card" aria-label="Memories">
        <h2 className="home-card__label">MEMORIES</h2>
        {failed && memories === null && (
          <p role="alert">Tagalong could not read these memories. Reopen Home to try again.</p>
        )}
        {memories !== null && memories.length === 0 && <p>{name} doesn’t remember anything yet.</p>}
        {memories !== null && memories.length > 0 && (
          <ul aria-label={title} className="memory-list">
            {memories.map((memory) => (
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
    </>
  );
}
