/**
 * Tests for MemoryTimeline: year blocks, folding, the Undated group, opening an entry, delete.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryEntry } from '../shapes';
import { MemoryTimeline } from './memory-timeline';

const AT = '2026-10-16T09:00:00.000Z';
let n = 0;
function fact(over: Partial<MemoryEntry> = {}): MemoryEntry {
  n += 1;
  return { id: `t${n}`, kind: 'fact', text: `Fact number ${n}`, createdAt: AT, ...over };
}

function show(entries: MemoryEntry[], onDelete = vi.fn()) {
  render(<MemoryTimeline entries={entries} onDelete={onDelete} />);
  return onDelete;
}

describe('MemoryTimeline', () => {
  it('renders a block per year, newest first, with categories inside', () => {
    show([
      fact({ text: 'Joined Acme', category: 'Work', spanStart: '2023' }),
      fact({ text: 'Learned Rust', category: 'Skills', spanStart: '2023' }),
      fact({ text: 'Data engineer', category: 'Work', spanStart: '2019' }),
    ]);
    const years = screen.getAllByRole('region');
    expect(years.map((y) => y.getAttribute('aria-label'))).toEqual(['2023', '2019']);
    expect(within(years[0]!).getByRole('heading', { level: 3, name: '2023' })).toBeInTheDocument();
    expect(within(years[0]!).getByText('Work')).toBeInTheDocument();
    expect(within(years[0]!).getByText('Skills')).toBeInTheDocument();
    expect(within(years[0]!).getByText('Joined Acme')).toBeInTheDocument();
  });

  it('shows a multi-year fact once, with its range', () => {
    show([fact({ text: 'Data engineer', spanStart: '2019', spanEnd: '2021' })]);
    expect(screen.getAllByText('Data engineer')).toHaveLength(1);
    expect(screen.getByText('2019–2021')).toBeInTheDocument();
  });

  it('shows an open-ended fact as since its start', () => {
    show([fact({ text: 'Senior engineer', spanStart: '2019' })]);
    expect(screen.getByText('since 2019')).toBeInTheDocument();
  });

  it('shows quiet years as one folded range', () => {
    show([fact({ spanStart: '2012' }), fact({ spanStart: '2020' })]);
    expect(screen.getByText('2013–2019')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '2015' })).toBeNull();
  });

  it('shows a single quiet year as that year', () => {
    show([fact({ spanStart: '2018' }), fact({ spanStart: '2020' })]);
    expect(screen.getByText('2019')).toBeInTheDocument();
  });

  it('puts the Undated group last', () => {
    show([fact({ text: 'No date', category: 'Work' }), fact({ text: 'Dated', spanStart: '2020' })]);
    const regions = screen.getAllByRole('region');
    expect(regions[regions.length - 1]).toHaveAccessibleName('Undated');
    expect(within(regions[regions.length - 1]!).getByText('No date')).toBeInTheDocument();
  });

  it('opens an entry to its quote and source', () => {
    show([fact({ text: 'Writes TypeScript', evidence: 'TypeScript 62%', source: 'github' })]);
    const entry = screen.getByText('Writes TypeScript').closest('details')!;
    expect(entry).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('Writes TypeScript'));
    expect(within(entry).getByText('“TypeScript 62%”')).toBeInTheDocument();
    expect(within(entry).getByText('GitHub')).toBeInTheDocument();
  });

  it('marks a personal fact only if asked', () => {
    show([fact({ text: 'Lives in Leeds', visibility: 'asked' })]);
    const entry = screen.getByText('Lives in Leeds').closest('details')!;
    expect(entry).not.toHaveAttribute('open');
    expect(within(entry.querySelector('summary')!).getByText('only if asked')).toBeInTheDocument();
  });

  it('has a Delete that names the fact and calls back with its id', () => {
    const entry = fact({ text: 'Writes TypeScript', spanStart: '2020' });
    const onDelete = show([entry]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete: Writes TypeScript' }));
    expect(onDelete).toHaveBeenCalledWith(entry.id);
  });

  it('drops the year when its last fact is gone', () => {
    const entry = fact({ spanStart: '2020' });
    const { rerender } = render(<MemoryTimeline entries={[entry]} onDelete={() => {}} />);
    expect(screen.getByRole('heading', { name: '2020' })).toBeInTheDocument();
    rerender(<MemoryTimeline entries={[]} onDelete={() => {}} />);
    expect(screen.queryByRole('heading', { name: '2020' })).toBeNull();
  });

  it('wraps a very long word inside its entry', () => {
    const { container } = render(
      <MemoryTimeline entries={[fact({ text: 'w'.repeat(1000) })]} onDelete={() => {}} />,
    );
    expect(container.querySelector('style')?.textContent).toMatch(
      /\.mt-fact__text[^{]*\{[^}]*overflow-wrap: anywhere/,
    );
  });

  it('hides the Other heading when it is the only group in a year', () => {
    show([fact({ spanStart: '2020' }), fact({ category: 'Work', spanStart: '2018' })]);
    const [y2020, y2018] = screen.getAllByRole('region');
    expect(within(y2020!).queryByRole('heading', { level: 4 })).toBeNull();
    expect(within(y2018!).getByRole('heading', { level: 4, name: 'Work' })).toBeInTheDocument();
  });

  it('keeps the Other heading beside real categories', () => {
    show([fact({ spanStart: '2020' }), fact({ category: 'Work', spanStart: '2020' })]);
    expect(screen.getByRole('heading', { level: 4, name: 'Other' })).toBeInTheDocument();
  });
});
