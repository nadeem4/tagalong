/** Tests for the check card: the facts shown before a community app or expert is connected. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppRow } from '../shapes';
import { CheckCard } from './check-card';

const ROW: AppRow = {
  id: 'io.github.bob/x',
  name: 'x',
  version: '1',
  description: 'd',
  official: false,
  publisher: 'io.github.bob/x',
  runs: 'pc',
  host: null,
  signIn: 'none',
  licence: 'MIT',
  repo: 'https://github.com/bob/x',
};

function setup(row: Parameters<typeof CheckCard>[0]['row'] = ROW, busy = false) {
  const onConnect = vi.fn();
  const onBack = vi.fn();
  render(<CheckCard row={row} busy={busy} onConnect={onConnect} onBack={onBack} />);
  return { onConnect, onBack };
}

describe('CheckCard', () => {
  it('shows who made it, where it runs, the licence and that nobody audited it', () => {
    setup();
    expect(screen.getByText('Made by io.github.bob/x (not the service itself)')).toBeTruthy();
    expect(screen.getByText('Runs on your PC')).toBeTruthy();
    expect(screen.getByText('Licence MIT')).toBeTruthy();
    expect(screen.getByText('Not yet audited by anyone')).toBeTruthy();
    expect(screen.getByText('Scout still asks you before each use.')).toBeTruthy();
  });

  it('says where a hosted app runs and what the sign-in is', () => {
    setup({ ...ROW, runs: 'hosted', host: 'mcp.example.com', signIn: 'browser' });
    expect(screen.getByText('Hosted by mcp.example.com')).toBeTruthy();
    expect(screen.getByText('Sign-in: your browser')).toBeTruthy();
  });

  it('shows an unknown licence as Unknown', () => {
    setup({ ...ROW, licence: '' });
    expect(screen.getByText('Licence Unknown')).toBeTruthy();
  });

  it('Connect anyway and Back call their handlers', () => {
    const { onConnect, onBack } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Connect anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onConnect).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('See its code is a safe new-tab link, absent without a repo', () => {
    const { unmount } = render(
      <CheckCard row={ROW} busy={false} onConnect={vi.fn()} onBack={vi.fn()} />,
    );
    const link = screen.getByRole('link', { name: 'See its code' });
    expect(link.getAttribute('href')).toBe(ROW.repo);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    unmount();
    setup({ ...ROW, repo: '' });
    expect(screen.queryByRole('link', { name: 'See its code' })).toBeNull();
  });

  it('disables Connect anyway while busy', () => {
    setup(ROW, true);
    const button = screen.getByRole('button', { name: 'Connect anyway' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes an expert card: publisher Unknown, runs on the PC, no sign-in line', () => {
    setup({ name: 'Codex', publisher: 'Unknown', runs: 'pc', licence: 'Apache-2.0', repo: '' });
    expect(screen.getByText('Made by Unknown (not the service itself)')).toBeTruthy();
    expect(screen.queryByText(/Sign-in/)).toBeNull();
  });
});
