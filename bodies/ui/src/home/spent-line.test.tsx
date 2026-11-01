/** Tests for SpentLine: one quiet "Spent today" line that never gets in the way. */

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TurnEvent } from '../shapes';
import { SpentLine } from './spent-line';

const spend = (spentUsd: number) => () => Promise.resolve({ spentUsd, limitUsd: 5 });

describe('SpentLine', () => {
  it('shows Spent today with two decimals', async () => {
    render(<SpentLine read={spend(0.42)} />);
    expect(await screen.findByText('Spent today: $0.42')).toBeInTheDocument();
  });

  it('shows $0.00 when nothing is spent', async () => {
    render(<SpentLine read={spend(0)} />);
    expect(await screen.findByText('Spent today: $0.00')).toBeInTheDocument();
  });

  it('shows nothing and no error when the read rejects', async () => {
    const { container } = render(<SpentLine read={() => Promise.reject(new Error('down'))} />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing while loading', () => {
    const { container } = render(<SpentLine read={() => new Promise(() => undefined)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reads again when a turn ends, if given the turn events', async () => {
    let spent = 0.1;
    let handler: (event: TurnEvent) => void = () => undefined;
    render(
      <SpentLine
        read={() => Promise.resolve({ spentUsd: spent, limitUsd: 5 })}
        onTurnEvent={(next) => {
          handler = next;
          return () => undefined;
        }}
      />,
    );
    await screen.findByText('Spent today: $0.10');
    spent = 0.35;
    act(() => handler({ type: 'turn.completed', turnId: 't' } as never));
    await waitFor(() => expect(screen.getByText('Spent today: $0.35')).toBeInTheDocument());
  });
});
