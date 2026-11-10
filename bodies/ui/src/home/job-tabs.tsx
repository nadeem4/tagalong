/**
 * The job page's tab strip: a WAI-ARIA tablist with roving tabindex, so Tab lands on the chosen
 * tab and the arrow keys, Home and End move between them. The caller renders the tabpanel.
 * Contains JobTabs, TabDef, tabId and panelId.
 */
import { useRef, type KeyboardEvent } from 'react';

export interface TabDef {
  id: string;
  label: string;
}

export const tabId = (id: string): string => `job-tab-${id}`;
export const panelId = (id: string): string => `job-panel-${id}`;

function target(key: string, at: number, count: number): number {
  if (key === 'ArrowRight') return (at + 1) % count;
  if (key === 'ArrowLeft') return (at + count - 1) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return -1;
}

export function JobTabs({
  tabs,
  selected,
  onSelect,
  label = 'Job sections',
}: {
  tabs: TabDef[];
  selected: string;
  onSelect: (id: string) => void;
  /** The tablist's accessible name. */
  label?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: KeyboardEvent, at: number): void => {
    const next = tabs[target(event.key, at, tabs.length)];
    if (!next) return;
    event.preventDefault();
    onSelect(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div className="job-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, at) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[tab.id] = el;
          }}
          type="button"
          role="tab"
          id={tabId(tab.id)}
          aria-selected={tab.id === selected}
          aria-controls={panelId(tab.id)}
          tabIndex={tab.id === selected ? 0 : -1}
          className="job-tabs__tab"
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => move(event, at)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
