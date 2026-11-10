/** Tests for a grouped app row: Official head one click, community versions behind a check card. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppGroup, AppRow } from '../shapes';
import { AppGroupRow } from './app-group-row';

const row = (id: string, official: boolean, why?: string): AppRow => ({
  id,
  name: official ? 'Notion' : id,
  version: '1',
  description: 'd',
  official,
  publisher: official ? 'notion.com' : id,
  runs: official ? 'hosted' : 'pc',
  host: official ? 'mcp.notion.com' : null,
  signIn: 'none',
  licence: 'MIT',
  repo: 'https://github.com/x/y',
  ...(why === undefined ? {} : { why }),
});

const HEAD = row('com.notion/mcp', true);
const A = row('io.github.a/notion', false, 'Reads pages');
const B = row('io.github.b/notion', false, 'Edits pages');

function setup(group: AppGroup, busy: ReadonlySet<string> = new Set()) {
  const onConnect = vi.fn();
  const onConnectAnyway = vi.fn();
  render(
    <AppGroupRow
      group={group}
      busy={busy}
      onConnect={onConnect}
      onConnectAnyway={onConnectAnyway}
    />,
  );
  return { onConnect, onConnectAnyway };
}

describe('AppGroupRow', () => {
  it('an Official head connects in one press, with no card', () => {
    const { onConnect } = setup({ service: 'notion', official: HEAD, others: [A, B] });
    expect(screen.getByText('Official')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Check before connecting' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect Notion' }));
    expect(onConnect).toHaveBeenCalledWith(HEAD);
  });

  it('the Official head says who made it, where it runs and how you sign in', () => {
    setup({
      service: 'notion',
      official: { ...HEAD, runs: 'hosted', host: 'mcp.notion.com', signIn: 'browser' },
      others: [],
    });
    expect(screen.getByText(/Where it runs: hosted by mcp.notion.com/)).toBeTruthy();
    expect(screen.getByText(/Sign-in: your browser/)).toBeTruthy();
  });

  it('hides community versions behind a toggle and lists them with tags and why', () => {
    setup({ service: 'notion', official: HEAD, others: [A, B] });
    expect(screen.queryByText('io.github.a/notion')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 other versions' }));
    expect(screen.getByText('io.github.a/notion')).toBeTruthy();
    expect(screen.getAllByText('Community')).toHaveLength(2);
    expect(screen.getByText('Reads pages')).toBeTruthy();
    expect(screen.getAllByText(/Where it runs: your PC/)).toHaveLength(2);
    expect(screen.getAllByText(/Sign-in: /).length).toBeGreaterThanOrEqual(2);
  });

  it('Connect on a community version opens the card, Connect anyway confirms, Back closes', () => {
    const { onConnect, onConnectAnyway } = setup({
      service: 'notion',
      official: HEAD,
      others: [A, B],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 other versions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect io.github.a/notion' }));
    const card = screen.getByRole('group', { name: 'Check before connecting' });
    expect(onConnect).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('group', { name: 'Check before connecting' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect io.github.a/notion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Connect anyway' }));
    expect(onConnectAnyway).toHaveBeenCalledWith(A);
  });

  it('without an official version says so and lists every community version at once', () => {
    setup({ service: 'tinyapp', official: null, others: [A] });
    expect(screen.getByText('No official version')).toBeTruthy();
    expect(screen.getByText('io.github.a/notion')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /other version/ })).toBeNull();
  });

  it('disables Connect for an id whose call is running', () => {
    setup({ service: 'notion', official: HEAD, others: [] }, new Set([HEAD.id]));
    const button = screen.getByRole('button', { name: 'Connect Notion' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
