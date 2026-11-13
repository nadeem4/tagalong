/**
 * Home's memory timeline: what Scout knows about the person, one block per year (newest
 * first), the model's categories inside each year, quiet years folded, undated facts last.
 * Each fact opens to its quote and source. Contains MemoryTimeline, sourceLabel and deleteLabel.
 */

import type { MemoryEntry, TimelineFact, CategoryGroup } from '../shapes';
import { buildTimeline } from '../shapes';
import { Button } from '../controls/button';
import { themeTokens as t, typeCss } from '../theme/tokens';

const SOURCE_LABELS: Record<string, string> = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  web: 'The web',
};
const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** Where a fact was read, in words; chat facts have no source line. */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? cap(source);
}

/** A delete button's name: the memory's start, so a long one stays a short name. */
export function deleteLabel(text: string): string {
  return `Delete: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`;
}

const CSS = `
.mt-block { margin-top: ${t.space.xl}px; padding-left: ${t.space.xl}px; border-left: 2px solid ${t.color.panelLine}; }
.mt-year { margin: 0; ${typeCss('title')}; color: ${t.color.panelText}; }
.mt-quiet { margin: 0; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.mt-cat { margin: ${t.space.lg}px 0 ${t.space.xs}px; ${typeCss('caption')}; color: ${t.color.panelMuted}; }
.mt-facts { list-style: none; margin: 0; padding: 0; }
.mt-fact { padding: ${t.space.xs}px 0; color: ${t.color.panelText}; }
.mt-fact summary { cursor: pointer; ${typeCss('bodyLead')}; }
.mt-fact__text { overflow-wrap: anywhere; min-width: 0; }
.mt-fact__range { margin-left: ${t.space.md}px; ${typeCss('small')}; color: ${t.color.panelMuted}; }
.mt-fact__more { margin: ${t.space.xs}px 0 ${t.space.xs}px ${t.space.xl}px; ${typeCss('small')}; color: ${t.color.panelMuted}; overflow-wrap: anywhere; }
.mt-fact__more p { margin: 0 0 ${t.space.xs}px; }
`;

function FactRow({ fact, onDelete }: { fact: TimelineFact; onDelete(id: string): void }) {
  const { entry, range } = fact;
  const asked = entry.visibility === 'asked';
  const meta = entry.source && entry.source !== 'chat' ? [sourceLabel(entry.source)] : [];
  return (
    <li>
      <details className="mt-fact">
        <summary>
          <span className="mt-fact__text">{entry.text}</span>
          {range !== null && <span className="mt-fact__range">{range}</span>}
          {asked && <span className="mt-fact__range">only if asked</span>}
        </summary>
        <div className="mt-fact__more">
          {entry.evidence && <p>“{entry.evidence}”</p>}
          {meta.map((part) => (
            <p key={part}>{part}</p>
          ))}
          <Button
            variant="quiet"
            aria-label={deleteLabel(entry.text)}
            onClick={() => onDelete(entry.id)}
          >
            Delete
          </Button>
        </div>
      </details>
    </li>
  );
}

function Groups({ groups, onDelete }: { groups: CategoryGroup[]; onDelete(id: string): void }) {
  // A lone "Other" says nothing the year heading does not, so its heading is left out.
  const lone = groups.length === 1 && groups[0]?.category === 'Other';
  return (
    <>
      {groups.map((g) => (
        <div key={g.category}>
          {!lone && <h4 className="mt-cat">{g.category}</h4>}
          <ul className="mt-facts">
            {g.facts.map((f) => (
              <FactRow key={f.entry.id} fact={f} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export function MemoryTimeline({
  entries,
  onDelete,
}: {
  entries: MemoryEntry[];
  onDelete(id: string): void;
}) {
  const { years, undated } = buildTimeline(entries);
  return (
    <div>
      <style>{CSS}</style>
      {years.map((block) =>
        block.kind === 'year' ? (
          <section key={block.year} className="mt-block" aria-label={block.year}>
            <h3 className="mt-year">{block.year}</h3>
            <Groups groups={block.groups} onDelete={onDelete} />
          </section>
        ) : (
          <p key={`q${block.from}`} className="mt-block mt-quiet">
            {block.from === block.to ? block.from : `${block.from}–${block.to}`}
          </p>
        ),
      )}
      {undated.length > 0 && (
        <section className="mt-block" aria-label="Undated">
          <h3 className="mt-year">Undated</h3>
          <Groups groups={undated} onDelete={onDelete} />
        </section>
      )}
    </div>
  );
}
