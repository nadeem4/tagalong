/**
 * Tests for SpentLine: one quiet "Spent today" line that never gets in the way.
 * Covers rendering, refresh on turn events, out-of-order replies and unmount.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TurnEvent } from '../shapes';
import { SpentLine } from './spent-line';

const completed: TurnEvent = { type: 'turn.completed', turnId: 't', text: '', stopReason: 'end' };
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
    act(() => handler(completed));
    await waitFor(() => expect(screen.getByText('Spent today: $0.35')).toBeInTheDocument());
  });

  it('keeps the latest reply when an earlier read resolves last', async () => {
    const resolvers: Array<(v: { spentUsd: number; limitUsd: number }) => void> = [];
    let handler: (event: TurnEvent) => void = () => undefined;
    render(
      <SpentLine
        read={() => new Promise((resolve) => resolvers.push(resolve))}
        onTurnEvent={(next) => {
          handler = next;
          return () => undefined;
        }}
      />,
    );
    act(() => handler(completed));
    await act(async () => resolvers[1]?.({ spentUsd: 0.9, limitUsd: 5 }));
    await act(async () => resolvers[0]?.({ spentUsd: 0.1, limitUsd: 5 }));
    expect(screen.getByText('Spent today: $0.90')).toBeInTheDocument();
  });

  it('unsubscribes on unmount and ignores a read that resolves afterwards', async () => {
    const stop = vi.fn();
    let resolve: (v: { spentUsd: number; limitUsd: number }) => void = () => undefined;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { unmount, container } = render(
      <SpentLine read={() => new Promise((r) => (resolve = r))} onTurnEvent={() => stop} />,
    );
    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ spentUsd: 0.5, limitUsd: 5 }));
    expect(container).toBeEmptyDOMElement();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
