/** Tests for AppSearch: the debounced search, Popular and Show more, grouped results, the empty state. */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostBridgeProvider } from '../host-bridge';
import type { AppGroup, AppRow } from '../shapes';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { AppSearch } from './app-search';

const row = (id: string, name: string, official: boolean): AppRow => ({
  id,
  name,
  version: '1',
  description: `${name} app`,
  official,
  publisher: official ? 'notion.com' : id,
  runs: official ? 'hosted' : 'pc',
  host: official ? 'mcp.notion.com' : null,
  signIn: 'none',
  licence: 'MIT',
  repo: '',
  added: false,
});

const NOTION = row('com.notion/mcp', 'Notion', true);
const GROUP: AppGroup = { service: 'notion', official: NOTION, others: [] };
const LINEAR = row('app.linear/mcp', 'Linear', true);
const ATLASSIAN = row('com.atlassian/mcp', 'Atlassian', true);
const MORE: AppGroup = { service: 'linear', official: LINEAR, others: [] };
const ADDED = { text: 'Notion added.', error: false, added: true };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function view(bridge: FakeHostBridge, refresh: number, busy: ReadonlySet<string>) {
  const onAdd = vi.fn().mockResolvedValue(null);
  const onAddAnyway = vi.fn().mockResolvedValue(null);
  const onAddApp = vi.fn().mockResolvedValue(true);
  const ui = (n: number) => (
    <HostBridgeProvider bridge={bridge}>
      <AppSearch
        busy={busy}
        apps={[]}
        refresh={n}
        offline={false}
        onAdd={onAdd}
        onAddAnyway={onAddAnyway}
        onAddApp={onAddApp}
      />
    </HostBridgeProvider>
  );
  return { onAdd, onAddAnyway, onAddApp, ui };
}

async function renderSearch(bridge: FakeHostBridge, busy: ReadonlySet<string> = new Set()) {
  const { ui, ...calls } = view(bridge, 0, busy);
  const result = render(ui(0));
  await act(async () => {
    await Promise.resolve();
  });
  return { ...calls, rerender: (n: number) => result.rerender(ui(n)) };
}

async function type(text: string) {
  fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: text } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });
}

describe('AppSearch', () => {
  it('shows Popular before typing, with the placeholder as the only hint, and hides it when typing', async () => {
    const bridge = createFakeHostBridge({
      setupFor: (query) =>
        query === undefined ? { popular: [NOTION] } : { appGroups: [GROUP], popular: [] },
    });
    await renderSearch(bridge);
    expect(screen.getByRole('region', { name: 'Popular' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Notion, Linear, a calendar…')).toBeTruthy();
    expect(screen.queryByText('Search the app registry')).toBeNull();
    await type('notion');
    expect(screen.queryByRole('region', { name: 'Popular' })).toBeNull();
  });

  it('says Results for "term" above the results', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    await renderSearch(bridge);
    await type('notion');
    expect(screen.getByRole('status')).toHaveTextContent('Results for "notion"');
  });

  it('keeps Popular on screen, dimmed, under Searching… while the first search loads', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ popular: [NOTION] }) });
    await renderSearch(bridge);
    bridge.setupOverview = () => new Promise(() => undefined);
    await type('cal');
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    expect(screen.getByRole('region', { name: 'Popular' })).toHaveClass('cx-stale');
  });

  it('a curated app already added says Added instead of offering Add', async () => {
    const bridge = createFakeHostBridge({
      setupFor: () => ({ popular: [{ ...NOTION, added: true }, LINEAR] }),
    });
    await renderSearch(bridge);
    expect(screen.queryByRole('button', { name: 'Add Notion' })).toBeNull();
    expect(within(screen.getByText('Notion').closest('li')!).getByText('Added')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Linear' })).toBeVisible();
  });

  it('Show more reveals the rest of the curated list and names them beside it', async () => {
    const bridge = createFakeHostBridge({
      setupFor: () => ({ popular: [NOTION], popularMore: [LINEAR, ATLASSIAN] }),
    });
    await renderSearch(bridge);
    expect(screen.queryByRole('button', { name: 'Add Linear' })).toBeNull();
    expect(screen.getByText('Linear, Atlassian…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getByRole('button', { name: 'Add Linear' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Atlassian' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('has no Show more when the brain sends nothing more', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ popular: [NOTION] }) });
    await renderSearch(bridge);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('searches with the query only after the debounce, trimmed', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    await renderSearch(bridge);
    fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: ' notion ' } });
    expect(bridge.setupOverviewCalls).toEqual([{}]);
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(bridge.setupOverviewCalls.at(-1)).toEqual({ query: 'notion' });
    expect(screen.getByRole('button', { name: 'Add Notion' })).toBeTruthy();
  });

  it('whitespace alone counts as no query', async () => {
    const bridge = createFakeHostBridge();
    await renderSearch(bridge);
    await type('   ');
    expect(bridge.setupOverviewCalls).toEqual([{}]);
  });

  it('announces Searching… while a search loads and dims the old results', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    await renderSearch(bridge);
    await type('notion');
    let finish: () => void = () => undefined;
    const settled = bridge.setupOverview.bind(bridge);
    bridge.setupOverview = (query, cursor) =>
      new Promise((resolve) => {
        finish = () => resolve(settled(query, cursor));
      });
    await type('notio');
    expect(screen.getByRole('status')).toHaveTextContent('Searching…');
    expect(screen.getByRole('list', { name: 'Results' })).toHaveClass('cx-stale');
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).not.toHaveTextContent('Searching…');
    expect(screen.getByRole('list', { name: 'Results' })).not.toHaveClass('cx-stale');
  });

  it('Show more asks for the next cursor and appends the page', async () => {
    const bridge = createFakeHostBridge({
      setupFor: (_query, cursor) =>
        cursor === undefined
          ? { appGroups: [GROUP], nextCursor: 'c2' }
          : { appGroups: [MORE], nextCursor: null },
    });
    await renderSearch(bridge);
    await type('app');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      await Promise.resolve();
    });
    expect(bridge.setupOverviewCalls.at(-1)).toEqual({ query: 'app', cursor: 'c2' });
    expect(screen.getByRole('button', { name: 'Add Notion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Linear' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('an Official head adds through onAdd with the query it was found by', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    const { onAdd } = await renderSearch(bridge);
    await type('notion');
    fireEvent.click(screen.getByRole('button', { name: 'Add Notion' }));
    expect(onAdd).toHaveBeenCalledWith(NOTION, 'notion');
  });

  it('says what it found nothing for, and offers adding it yourself', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [] }) });
    await renderSearch(bridge);
    await type('xyz');
    expect(screen.getByText('No apps match "xyz".')).toBeTruthy();
    expect(screen.getByText('Try another word, or add it yourself.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Can't find it\? Add it yourself/ })).toBeTruthy();
  });

  it('does not say nothing matched while the next search is still running', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [] }) });
    await renderSearch(bridge);
    await type('xyz');
    expect(screen.getByText('No apps match "xyz".')).toBeTruthy();
    bridge.setupOverview = () => new Promise(() => undefined);
    await type('xyzw');
    expect(screen.queryByText(/No apps match/)).toBeNull();
  });

  it('offers adding it yourself under the results and under Popular too', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ popular: [NOTION] }) });
    await renderSearch(bridge);
    expect(screen.getByRole('button', { name: /Can't find it\? Add it yourself/ })).toBeTruthy();
  });

  it('Add it yourself opens the form in place of the list, Cancel brings the list back', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ popular: [NOTION] }) });
    await renderSearch(bridge);
    fireEvent.click(screen.getByRole('button', { name: /Can't find it\? Add it yourself/ }));
    expect(screen.getByRole('heading', { name: 'Add it yourself' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Popular' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('region', { name: 'Popular' })).toBeTruthy();
  });

  it('says plainly when the app list cannot be loaded', async () => {
    const bridge = createFakeHostBridge({ overviewFails: 'boom' });
    await renderSearch(bridge);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Scout couldn't load the app list. Check your internet and try again.",
    );
  });

  it('a failing search drops the earlier results and shows only the plain line', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    await renderSearch(bridge);
    await type('notion');
    bridge.setupOverview = () => Promise.reject(new Error('boom'));
    await type('notion2');
    expect(screen.queryByRole('button', { name: 'Add Notion' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the app list/);
    expect(screen.queryByText(/No apps match/)).toBeNull();
  });

  it('a failing Show more keeps the earlier results and shows the plain line', async () => {
    const bridge = createFakeHostBridge({
      setupFor: () => ({ appGroups: [GROUP], nextCursor: 'c2' }),
    });
    await renderSearch(bridge);
    await type('app');
    bridge.setupOverview = () => Promise.reject(new Error('boom'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Add Notion' })).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load the app list/);
  });

  it('a Popular community app is not shown as Official', async () => {
    const community = row('io.github.a/notion', 'Notion', false);
    const bridge = createFakeHostBridge({ setupFor: () => ({ popular: [community] }) });
    await renderSearch(bridge);
    const popular = screen.getByRole('region', { name: 'Popular' });
    expect(popular.textContent).not.toContain('Official');
    expect(popular.textContent).toContain('Community');
  });

  it('only the newest search writes its results', async () => {
    const bridge = createFakeHostBridge();
    const fast = structuredClone(bridge.setup);
    const slow = { ...fast, appGroups: [GROUP] };
    let finishSlow: () => void = () => undefined;
    bridge.setupOverview = (query) =>
      query === 'slow'
        ? new Promise((resolve) => {
            finishSlow = () => resolve(slow);
          })
        : Promise.resolve(fast);
    await renderSearch(bridge);
    await type('slow');
    await type('fast');
    await act(async () => {
      finishSlow();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: 'Add Notion' })).toBeNull();
  });

  it('keeps the outcome on its row when the apps change, and clears it on the next search', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    const { onAdd, rerender } = await renderSearch(bridge);
    onAdd.mockResolvedValue(ADDED);
    await type('notion');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Notion' }));
      await Promise.resolve();
    });
    expect(screen.getByText('Notion added.')).toBeTruthy();
    const calls = bridge.setupOverviewCalls.length;
    await act(async () => {
      rerender(1);
      await Promise.resolve();
    });
    expect(bridge.setupOverviewCalls.length).toBe(calls);
    expect(screen.getByText('Notion added.')).toBeTruthy();
    await type('linear');
    expect(screen.queryByText('Notion added.')).toBeNull();
  });
});
