/**
 * Tests for the pure memory timeline builder: blocks, ranges, folding, Undated, years covered.
 */
import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from './memory';
import { buildTimeline } from './timeline';

const AT = '2026-10-16T09:00:00.000Z';
let n = 0;
function fact(over: Partial<MemoryEntry> = {}): MemoryEntry {
  n += 1;
  return { id: `m${n}`, kind: 'fact', text: `Fact ${n}`, createdAt: AT, ...over };
}

describe('buildTimeline', () => {
  it('puts a multi-year fact once, at its start year, with its range', () => {
    const f = fact({ category: 'Work', spanStart: '2019', spanEnd: '2021' });
    const t = buildTimeline([f]);
    expect(t.years).toEqual([
      {
        kind: 'year',
        year: '2019',
        groups: [{ category: 'Work', facts: [{ entry: f, range: '2019–2021' }] }],
      },
    ]);
  });

  it('reads an open-ended fact as "since 2019"', () => {
    const t = buildTimeline([fact({ category: 'Work', spanStart: '2019' })]);
    const block = t.years[0];
    expect(block?.kind === 'year' && block.groups[0]?.facts[0]?.range).toBe('since 2019');
  });

  it('has no range for a single-year fact', () => {
    const t = buildTimeline([fact({ spanStart: '2020', spanEnd: '2020' })]);
    const block = t.years[0];
    expect(block?.kind === 'year' && block.groups[0]?.facts[0]?.range).toBeNull();
  });

  it('lists years newest first with categories inside, Other last', () => {
    const t = buildTimeline([
      fact({ category: 'Work', spanStart: '2020' }),
      fact({ spanStart: '2024' }),
      fact({ category: 'Skills', spanStart: '2024' }),
    ]);
    expect(
      t.years.filter((b) => b.kind === 'year').map((b) => b.kind === 'year' && b.year),
    ).toEqual(['2024', '2020']);
    const first = t.years[0];
    expect(first?.kind === 'year' && first.groups.map((g) => g.category)).toEqual([
      'Skills',
      'Other',
    ]);
  });

  it('folds quiet years into one range', () => {
    const t = buildTimeline([fact({ spanStart: '2012' }), fact({ spanStart: '2020' })]);
    expect(t.years.map((b) => b.kind)).toEqual(['year', 'quiet', 'year']);
    expect(t.years[1]).toEqual({ kind: 'quiet', from: '2013', to: '2019' });
  });

  it('folds a single quiet year to one block', () => {
    const t = buildTimeline([fact({ spanStart: '2018' }), fact({ spanStart: '2020' })]);
    expect(t.years[1]).toEqual({ kind: 'quiet', from: '2019', to: '2019' });
  });

  it('sends undated facts to the Undated group by category', () => {
    const t = buildTimeline([fact({ category: 'Work' }), fact({ category: 'Work' }), fact()]);
    expect(t.years).toEqual([]);
    expect(t.undated.map((g) => [g.category, g.facts.length])).toEqual([
      ['Work', 2],
      ['Other', 1],
    ]);
  });

  it('lands old rows with no category in Other', () => {
    const t = buildTimeline([fact({ spanStart: '2021' })]);
    const block = t.years[0];
    expect(block?.kind === 'year' && block.groups[0]?.category).toBe('Other');
  });

  it('ignores non-fact kinds', () => {
    const t = buildTimeline([
      { id: 'p', kind: 'preference', text: 'x', createdAt: AT, spanStart: '2020' },
      { id: 's', kind: 'summary', text: 'y', createdAt: AT },
    ]);
    expect(t).toEqual({ years: [], undated: [], covered: null });
  });

  it('covers first start to now when a dated fact is still true', () => {
    const t = buildTimeline([
      fact({ spanStart: '2012', spanEnd: '2016' }),
      fact({ spanStart: '2019', spanEnd: '2026' }),
      fact({ spanStart: '2022' }),
    ]);
    expect(t.covered).toBe('2012–now');
  });

  it('has no coverage when nothing is dated', () => {
    expect(buildTimeline([fact()]).covered).toBeNull();
  });

  it('covers first start to last end when every dated fact has ended', () => {
    const t = buildTimeline([
      fact({ spanStart: '2012', spanEnd: '2016' }),
      fact({ spanStart: '2019', spanEnd: '2021' }),
    ]);
    expect(t.covered).toBe('2012–2021');
  });

  it('matches years on the first four characters of a span', () => {
    const t = buildTimeline([
      fact({ spanStart: '2019-03', spanEnd: '2021-06' }),
      fact({ spanStart: '2021-11' }),
    ]);
    expect(t.years.map((b) => (b.kind === 'year' ? b.year : 'quiet'))).toEqual([
      '2021',
      'quiet',
      '2019',
    ]);
    const old = t.years[2];
    expect(old?.kind === 'year' && old.groups[0]?.facts[0]?.range).toBe('2019–2021');
    expect(t.covered).toBe('2019–now');
  });
});
