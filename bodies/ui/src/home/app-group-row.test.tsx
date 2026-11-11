/** Tests for a grouped app row: one verb per row, other makers behind a toggle, a check card first. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AppGroup, AppRow } from '../shapes';
import { AppGroupRow } from './app-group-row';
import type { Outcome } from './outcome';

const row = (id: string, name: string, official: boolean, why?: string): AppRow => ({
  id,
  name,
  version: '1',
  description: `${name} description`,
  official,
  publisher: official ? 'notion.com' : 'acme-dev',
  runs: official ? 'hosted' : 'pc',
  host: official ? 'mcp.notion.com' : null,
  signIn: official ? 'browser' : 'none',
  licence: 'MIT',
  repo: 'https://github.com/x/y',
  added: false,
  ...(why === undefined ? {} : { why }),
});

const HEAD = row('com.notion/mcp', 'Notion', true);
const A = row('io.github.a/notion', 'Notion', false, 'Reads pages');
const B = row('io.github.b/notion', 'Notion', false, 'Edits pages');

function setup(
  group: AppGroup,
  busy: ReadonlySet<string> = new Set(),
  outcomes: ReadonlyMap<string, Outcome> = new Map(),
) {
  const onAdd = vi.fn();
  const onAddAnyway = vi.fn();
  render(
    <ul>
      <AppGroupRow
        group={group}
        busy={busy}
        outcomes={outcomes}
        onAdd={onAdd}
        onAddAnyway={onAddAnyway}
      />
    </ul>,
  );
  return { onAdd, onAddAnyway };
}

describe('AppGroupRow', () => {
  it('an Official head adds in one press, with no card', () => {
    const { onAdd } = setup({ service: 'notion', official: HEAD, others: [A, B] });
    expect(screen.getByText('Official')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Check first' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Notion' }));
    expect(onAdd).toHaveBeenCalledWith(HEAD);
  });

  it('a row is the name, its description and one meta line of facts', () => {
    setup({ service: 'notion', official: HEAD, others: [] });
    expect(screen.getByText('Notion description')).toBeTruthy();
    expect(screen.getByText('Runs on the web · Browser sign-in')).toBeTruthy();
    expect(screen.queryByText(/Made by/)).toBeNull();
  });

  it('hides other makers behind a toggle that says how many', () => {
    setup({ service: 'notion', official: HEAD, others: [A, B] });
    expect(screen.queryByText('Notion, by acme-dev')).toBeNull();
    const toggle = screen.getByRole('button', { name: '2 more from other makers' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getAllByText('Notion, by acme-dev')).toHaveLength(2);
    expect(screen.getAllByText('Community')).toHaveLength(2);
    expect(screen.getByText('Reads pages')).toBeTruthy();
    // The label stays; only the chevron and aria-expanded change.
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '2 more from other makers' }));
    expect(screen.queryByText('Reads pages')).toBeNull();
  });

  it('an empty why falls back to the description', () => {
    setup({ service: 'notion', official: HEAD, others: [row('io.c/notion', 'Notion', false, '')] });
    fireEvent.click(screen.getByRole('button', { name: '1 more from another maker' }));
    // The head's own description plus the community row's fallback.
    expect(screen.getAllByText('Notion description')).toHaveLength(2);
  });

  it('one other maker reads "1 more from another maker"', () => {
    setup({ service: 'notion', official: HEAD, others: [A] });
    expect(screen.getByRole('button', { name: '1 more from another maker' })).toBeTruthy();
  });

  it('a community title is "Name, by maker" with the registry id in its tooltip', () => {
    setup({ service: 'notion', official: null, others: [A] });
    expect(screen.getByText('Notion, by acme-dev')).toHaveAttribute('title', A.id);
  });

  it('Add… on a community row opens the card, Add anyway confirms, Back closes and refocuses', () => {
    const { onAdd, onAddAnyway } = setup({ service: 'notion', official: HEAD, others: [A, B] });
    fireEvent.click(screen.getByRole('button', { name: '2 more from other makers' }));
    const add = screen.getAllByRole('button', { name: 'Add Notion, by acme-dev' })[0]!;
    expect(add).toHaveTextContent('Add…');
    fireEvent.click(add);
    const card = screen.getByRole('group', { name: 'Check first' });
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('group', { name: 'Check first' })).toBeNull();
    expect(document.activeElement).toBe(add);
    fireEvent.click(add);
    fireEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(onAddAnyway).toHaveBeenCalledWith(A);
  });

  it('without an official version the community rows are listed at once, with no toggle', () => {
    setup({ service: 'tinyapp', official: null, others: [A] });
    expect(screen.getByText('Notion, by acme-dev')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /more from/ })).toBeNull();
  });

  it('shows "Waiting for you…" instead of the button while the Allow card is open', () => {
    setup({ service: 'notion', official: HEAD, others: [] }, new Set([HEAD.id]));
    expect(screen.getByText('Waiting for you…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Notion' })).toBeNull();
  });

  it('an added outcome replaces the button on that row', () => {
    setup(
      { service: 'notion', official: HEAD, others: [] },
      new Set(),
      new Map([[HEAD.id, { text: 'Notion added.', error: false, added: true }]]),
    );
    expect(screen.getByText('Notion added.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add Notion' })).toBeNull();
  });

  it('a refusal shows on the row and keeps the button so it can be tried again', () => {
    setup(
      { service: 'notion', official: HEAD, others: [] },
      new Set(),
      new Map([[HEAD.id, { text: 'Okay, nothing was changed.', error: false, added: false }]]),
    );
    expect(screen.getByText('Okay, nothing was changed.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Notion' })).toBeTruthy();
  });
});
