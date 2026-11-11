/**
 * Tests for the finish card's "Ready to use" block: what the connect step set up, with a New
 * tag, and nothing at all when nothing was connected.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FinishCard } from './finish-card';

function card(ready?: Parameters<typeof FinishCard>[0]['ready']) {
  render(
    <FinishCard
      askKey="Ctrl+Shift+Space"
      talkKey="Right Ctrl"
      onOpenHome={vi.fn()}
      onClose={vi.fn()}
      {...(ready === undefined ? {} : { ready })}
    />,
  );
}

describe('FinishCard', () => {
  it('Done carries the shared final-button class', () => {
    card();
    expect(screen.getByRole('button', { name: 'Done' })).toHaveClass('wt-final');
  });

  it('Ready to use lists what was connected', () => {
    card([
      { name: 'Google Calendar', state: 'connected' },
      { name: 'Claude Code', state: 'installing' },
      { name: 'Gmail', state: 'signin' },
    ]);
    expect(screen.getByText('Ready to use')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Ready to use' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Google Calendar');
    expect(items[0]).toHaveTextContent('Connected');
    expect(items[1]).toHaveTextContent('Claude Code');
    expect(items[1]).toHaveTextContent('Still installing. Scout will tell you when it’s ready.');
    expect(items[2]).toHaveTextContent('Needs sign-in. Finish it in Home, under Connections.');
  });

  it('leaves the block out when nothing was connected', () => {
    card([]);
    expect(screen.queryByText('Ready to use')).not.toBeInTheDocument();
  });

  it('leaves the block out when the connect step was never read', () => {
    card();
    expect(screen.queryByText('Ready to use')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Scout is on your screen' })).toBeInTheDocument();
  });
});
