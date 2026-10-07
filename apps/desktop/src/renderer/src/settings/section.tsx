import type { ReactNode } from 'react';

/** The sections in the order the window shows them; the nav links to each by id. */
export const SECTIONS = [
  { id: 'pets', title: 'Pets' },
  { id: 'keys', title: 'Keys and services' },
  { id: 'summaries', title: 'Summaries' },
  { id: 'hotkeys', title: 'Hotkeys' },
  { id: 'sight', title: 'Sight' },
  { id: 'awareness', title: 'Awareness' },
  { id: 'browser', title: 'Browser extension' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** One off-white panel with a short pixel heading. */
export function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)?.title ?? id;
  return (
    <section id={id} className="tg-panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="tg-px tg-panel__heading">
        {title}
      </h2>
      {children}
    </section>
  );
}
