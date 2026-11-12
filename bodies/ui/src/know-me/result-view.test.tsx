/** Tests for ResultView: the portrait first, then what it is based on, two steps. */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KnowMeStatus, MemoryEntry } from '../shapes';
import { gapsFrom, ResultView } from './result-view';

const AT = '2026-11-12T09:00:00.000Z';
const fact = (over: Partial<MemoryEntry> & { id: string; text: string }): MemoryEntry => ({
  kind: 'fact',
  createdAt: AT,
  visibility: 'free',
  ...over,
});
const FACTS: MemoryEntry[] = [
  fact({ id: '1', text: 'Software engineer', tag: 'work', source: 'linkedin' }),
  fact({ id: '2', text: 'Python and TypeScript', tag: 'skills', source: 'github' }),
  fact({
    id: '3',
    text: 'Lives in Leeds',
    tag: 'personal',
    source: 'linkedin',
    visibility: 'asked',
    evidence: 'Leeds, United Kingdom',
  }),
];
const PORTRAIT = 'You build things end to end.\n\nYou also explain AI in short videos.';

function view(over: Partial<Parameters<typeof ResultView>[0]> = {}) {
  const onDone = vi.fn();
  render(<ResultView portrait={PORTRAIT} gaps={[]} facts={FACTS} onDone={onDone} {...over} />);
  return { onDone };
}

describe('ResultView', () => {
  it('shows the portrait and the fact count first', () => {
    view();
    expect(screen.getByRole('heading', { name: "Here's who I think you are" })).toBeInTheDocument();
    expect(screen.getByText('You build things end to end.')).toBeInTheDocument();
    expect(screen.getByText('You also explain AI in short videos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Looks right' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: "What's this based on? (3 facts)" }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Software engineer')).not.toBeInTheDocument();
  });

  it('opens the facts from the based-on button, and back returns to the portrait', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: "What's this based on? (3 facts)" }));
    expect(screen.getByRole('heading', { name: 'What I found' })).toBeInTheDocument();
    expect(screen.getByText('Software engineer')).toBeInTheDocument();
    expect(screen.queryByText('You build things end to end.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to portrait' }));
    expect(screen.getByText('You build things end to end.')).toBeInTheDocument();
  });

  it('narrows the facts to one tag', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: /based on/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Skills/ }));
    const list = screen.getByRole('list', { name: 'Facts' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Python and TypeScript')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('shows where each fact came from and marks an asked fact "only if asked"', () => {
    view();
    fireEvent.click(screen.getByRole('button', { name: /based on/ }));
    const rows = within(screen.getByRole('list', { name: 'Facts' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('LinkedIn');
    expect(rows[1]).toHaveTextContent('GitHub');
    expect(rows[0]).not.toHaveTextContent('only if asked');
    expect(rows[2]).toHaveTextContent('only if asked');
    expect(rows[2]).toHaveTextContent('Leeds, United Kingdom');
  });

  it('lists the gaps under the portrait', () => {
    view({ gaps: ['LinkedIn PDF: No text found in the PDF.'] });
    expect(screen.getByText('LinkedIn PDF: No text found in the PDF.')).toBeInTheDocument();
  });

  it('says plainly that nothing was found when there is no portrait', () => {
    view({ portrait: null, facts: [], gaps: ['Not enough found to write a portrait.'] });
    expect(screen.getByText('I did not find enough to write a portrait.')).toBeInTheDocument();
    expect(screen.getByText('Not enough found to write a portrait.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /based on/ })).not.toBeInTheDocument();
  });

  it('calls onDone from Looks right and from Done', () => {
    const { onDone } = view();
    fireEvent.click(screen.getByRole('button', { name: 'Looks right' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /based on/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('says "1 fact" for one fact', () => {
    view({ facts: [FACTS[0]!] });
    expect(
      screen.getByRole('button', { name: "What's this based on? (1 fact)" }),
    ).toBeInTheDocument();
  });
});

describe('gapsFrom', () => {
  it('names the source of each gap, and leaves the portrait row bare', () => {
    const status: KnowMeStatus = {
      done: true,
      sources: [
        { name: 'GitHub', state: 'done' },
        { name: 'LinkedIn PDF', state: 'failed', gap: 'No text found in the PDF.' },
        { name: 'portrait', state: 'failed', gap: 'Not enough found to write a portrait.' },
      ],
    };
    expect(gapsFrom(status)).toEqual([
      'LinkedIn PDF: No text found in the PDF.',
      'Not enough found to write a portrait.',
    ]);
    expect(gapsFrom(null)).toEqual([]);
  });
});
