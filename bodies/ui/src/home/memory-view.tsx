/**
 * Home's "What Scout remembers" page: Scout's facts, preferences and conversation summaries,
 * newest first, each with Delete. Contains MemoryView.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MemoryEntry } from '../shapes';
import { useHostBridge } from '../host-bridge';
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
.memory-head { display: flex; flex-direction: column; gap: ${t.space.xs}px; padding: ${t.space.xxl}px ${t.space.xxl}px ${t.space.md}px; }
.memory-head p { margin: 0; font-size: ${t.fontSize.body}px; color: ${t.color.panelMuted}; }
.memory-row { display: flex; align-items: flex-start; gap: ${t.space.lg}px; padding: ${t.space.md}px;
  border-radius: ${t.radius.row}px; color: ${t.color.panelText}; }
.memory-row:hover { background: ${t.color.panelTile}; }
.memory-row__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${t.space.xxs}px; }
.memory-row__kind { font-size: ${t.fontSize.small}px; color: ${t.color.panelMuted}; }
.memory-row__text { font-size: ${t.fontSize.body}px; overflow-wrap: anywhere; }
.memory-row__delete { flex: none; width: 28px; height: 28px; border: 0; border-radius: ${t.radius.small}px;
  background: transparent; color: ${t.color.panelMuted}; cursor: pointer; font-size: 16px; line-height: 1; }
.memory-row__delete:hover { background: ${t.color.panelLine}; color: ${t.color.panelText}; }
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <style>{CSS}</style>
      <div className="memory-head">
        <h1 className="home-title">{title}</h1>
        <p>Kept until you delete them. Deleting one is for good.</p>
      </div>
      {failed && memories === null && (
        <p className="home-note" role="alert">
          Tagalong could not read these memories. Reopen Home to try again.
        </p>
      )}
      {memories !== null && memories.length === 0 && (
        <p className="home-note">{name} doesn’t remember anything yet.</p>
      )}
      {memories !== null && memories.length > 0 && (
        <ul aria-label={title} className="home-activity">
          {memories.map((memory) => (
            <li key={memory.id} className="memory-row">
              <span className="memory-row__body">
                <span className="memory-row__kind">
                  {KIND_LABELS[memory.kind]} · {day(memory.createdAt)}
                </span>
                <span className="memory-row__text">{memory.text}</span>
              </span>
              <button
                type="button"
                className="memory-row__delete"
                aria-label={deleteLabel(memory.text)}
                onClick={() => remove(memory.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
