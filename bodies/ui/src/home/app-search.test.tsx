/** Tests for AppSearch: the debounced search box, Popular row, grouped results and Load more. */
import { act, fireEvent, render, screen } from '@testing-library/react';
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
});

const NOTION = row('com.notion/mcp', 'Notion', true);
const GROUP: AppGroup = { service: 'notion', official: NOTION, others: [] };
const LINEAR = row('app.linear/mcp', 'Linear', true);
const MORE: AppGroup = { service: 'linear', official: LINEAR, others: [] };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function renderSearch(bridge: FakeHostBridge, busy: ReadonlySet<string> = new Set()) {
  const onConnect = vi.fn();
  const onConnectAnyway = vi.fn();
  render(
    <HostBridgeProvider bridge={bridge}>
      <AppSearch busy={busy} refresh={0} onConnect={onConnect} onConnectAnyway={onConnectAnyway} />
    </HostBridgeProvider>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { onConnect, onConnectAnyway };
}

async function type(text: string) {
  fireEvent.change(screen.getByLabelText('Search apps'), { target: { value: text } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });
}

describe('AppSearch', () => {
  it('shows the Popular row before typing and hides it when typing', async () => {
    const bridge = createFakeHostBridge({
      setupFor: (query) =>
        query === undefined ? { popular: [NOTION] } : { appGroups: [GROUP], popular: [] },
    });
    await renderSearch(bridge);
    expect(screen.getByRole('region', { name: 'Popular' })).toBeTruthy();
    await type('notion');
    expect(screen.queryByRole('region', { name: 'Popular' })).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Connect Notion' })).toBeTruthy();
  });

  it('whitespace alone counts as no query', async () => {
    const bridge = createFakeHostBridge();
    await renderSearch(bridge);
    await type('   ');
    expect(bridge.setupOverviewCalls).toEqual([{}]);
  });

  it('Load more asks for the next cursor and appends the page', async () => {
    const bridge = createFakeHostBridge({
      setupFor: (_query, cursor) =>
        cursor === undefined
          ? { appGroups: [GROUP], nextCursor: 'c2' }
          : { appGroups: [MORE], nextCursor: null },
    });
    await renderSearch(bridge);
    await type('app');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      await Promise.resolve();
    });
    expect(bridge.setupOverviewCalls.at(-1)).toEqual({ query: 'app', cursor: 'c2' });
    expect(screen.getByRole('button', { name: 'Connect Notion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('an Official head connects through onConnect with the query it was found by', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    const { onConnect } = await renderSearch(bridge);
    await type('notion');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Notion' }));
    expect(onConnect).toHaveBeenCalledWith(NOTION, 'notion');
  });

  it('says plainly when the registry cannot be reached', async () => {
    const bridge = createFakeHostBridge({ overviewFails: 'boom' });
    await renderSearch(bridge);
    expect(screen.getByRole('status')).toHaveTextContent(/couldn’t reach the registry/i);
  });

  it('a failing search keeps the earlier results and shows the plain line', async () => {
    const bridge = createFakeHostBridge({ setupFor: () => ({ appGroups: [GROUP] }) });
    await renderSearch(bridge);
    await type('notion');
    bridge.setupOverview = () => Promise.reject(new Error('boom'));
    await type('notion2');
    expect(screen.getByRole('button', { name: 'Connect Notion' })).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent(/couldn’t reach the registry/i);
  });

  it('a failing Load more keeps the earlier results and shows the plain line', async () => {
    const bridge = createFakeHostBridge({
      setupFor: () => ({ appGroups: [GROUP], nextCursor: 'c2' }),
    });
    await renderSearch(bridge);
    await type('app');
    bridge.setupOverview = () => Promise.reject(new Error('boom'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Connect Notion' })).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent(/couldn’t reach the registry/i);
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
    expect(screen.queryByRole('button', { name: 'Connect Notion' })).toBeNull();
  });
});
