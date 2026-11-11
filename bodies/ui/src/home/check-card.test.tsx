/** Tests for the check card: the facts, Back and Add anyway, and where keyboard focus goes. */
import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AppRow } from '../shapes';
import { CheckCard } from './check-card';

const ROW: AppRow = {
  id: 'io.github.bob/x',
  name: 'x',
  version: '1',
  description: 'd',
  official: false,
  publisher: 'bob',
  runs: 'pc',
  host: null,
  signIn: 'none',
  licence: 'MIT',
  repo: 'https://github.com/bob/x',
  added: false,
};

function setup(row: Parameters<typeof CheckCard>[0]['row'] = ROW, busy = false) {
  const onAddAnyway = vi.fn();
  const onBack = vi.fn();
  render(<CheckCard row={row} busy={busy} onAddAnyway={onAddAnyway} onBack={onBack} />);
  return { onAddAnyway, onBack };
}

describe('CheckCard', () => {
  it('is a Check first group with the facts and the line about Scout asking', () => {
    setup();
    const card = screen.getByRole('group', { name: 'Check first' });
    expect(card).toHaveTextContent('Made by bob, not x');
    expect(card).toHaveTextContent('Nobody has checked this one yet');
    expect(screen.getByText('Scout still asks before it changes anything with it.')).toBeTruthy();
  });

  it('an expert card says what the list does not, with no Unknown', () => {
    setup({ name: 'Codex' });
    expect(screen.getByRole('group', { name: 'Check first' }).textContent).not.toMatch(/Unknown/);
  });

  it('Add anyway and Back call their handlers', () => {
    const { onAddAnyway, onBack } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onAddAnyway).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('disables Add anyway while busy', () => {
    setup(ROW, true);
    const button = screen.getByRole('button', { name: 'Add anyway' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('focus moves into the card and back to the opener on Back', () => {
    const opener = createRef<HTMLButtonElement>();
    const onBack = vi.fn();
    render(
      <>
        <button ref={opener}>Add…</button>
        <CheckCard
          row={ROW}
          busy={false}
          onAddAnyway={vi.fn()}
          onBack={onBack}
          returnFocus={opener}
        />
      </>,
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Check first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toBe(opener.current);
    expect(onBack).toHaveBeenCalledOnce();
  });
});
