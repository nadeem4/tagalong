/**
 * Tests for step 10, Connect your tools: Gmail, Google Calendar, Notion and Claude Code as
 * Connections-style rows with their states, and the finish card's "Ready to use" list built
 * from the same overview.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SetupOverview } from '../shapes';
import { StepTen, readyOf } from './step-ten';
import { makeWalkthroughHost } from './test-host';

const ROW = {
  version: '1',
  description: 'd',
  official: true,
  publisher: 'x.com',
  runs: 'hosted' as const,
  host: 'mcp.x.com',
  signIn: 'browser' as const,
  licence: 'MIT',
  repo: 'https://github.com/x/y',
  added: false,
};

const row = (id: string, name: string) => ({ ...ROW, id, name });

const BASE: SetupOverview = {
  experts: [],
  apps: [],
  browseExperts: [],
  browseApps: [],
  popular: [row('com.google/gmail', 'Gmail'), row('com.notion/mcp', 'Notion')],
  popularMore: [],
  showMoreFrom: null,
  appGroups: [
    { service: 'calendar', official: row('com.google/calendar', 'Google Calendar'), others: [] },
  ],
  nextCursor: null,
  sources: null,
  stale: false,
  progress: null,
  failed: null,
} as SetupOverview;

function open(overview: Partial<SetupOverview> = {}) {
  const host = makeWalkthroughHost();
  host.setupOverview.mockImplementation(() => Promise.resolve({ ...BASE, ...overview }));
  render(<StepTen host={host} />);
  return host;
}

const itemOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement;

describe('StepTen', () => {
  it('lists Gmail, Google Calendar, Notion and Claude Code with their jobs', async () => {
    open();
    expect(screen.getByRole('heading', { name: 'Connect your tools' })).toBeInTheDocument();
    await screen.findByText('Gmail');
    expect(itemOf('Gmail')).toHaveTextContent('Draft replies to my inbox · Browser sign-in');
    expect(itemOf('Google Calendar')).toHaveTextContent(
      'Plan my day around my calendar · Browser sign-in',
    );
    expect(itemOf('Notion')).toHaveTextContent('Popular · Browser sign-in');
    expect(itemOf('Claude Code')).toHaveTextContent(
      'Fix this code, and other long, many-step jobs',
    );
    expect(itemOf('Claude Code')).toHaveTextContent('Recommended');
    expect(itemOf('Gmail')).toHaveTextContent('Official');
  });

  it('a curated app the registry no longer has is simply absent', async () => {
    open({ popular: [row('com.google/gmail', 'Gmail')], appGroups: [] });
    await screen.findByText('Gmail');
    expect(screen.queryByText('Notion')).not.toBeInTheDocument();
    expect(screen.queryByText('Google Calendar')).not.toBeInTheDocument();
  });

  it('never offers a community app in place of the Official one', async () => {
    open({
      popular: [
        row('com.google/gmail', 'Gmail'),
        { ...row('io.x/notion-fan', 'Notion'), official: false },
      ],
      appGroups: [],
    });
    await screen.findByText('Gmail');
    expect(screen.queryByText('Notion')).not.toBeInTheDocument();
  });

  it('Add connects the app by its registry id and shows Waiting for you', async () => {
    const host = open();
    await screen.findByText('Gmail');
    let finish: () => void = () => undefined;
    host.setupApp.mockImplementation(
      () =>
        new Promise<{ state?: string }>((resolve) => {
          finish = () => resolve({});
        }),
    );
    fireEvent.click(within(itemOf('Gmail')).getByRole('button', { name: 'Add Gmail' }));
    expect(host.setupApp).toHaveBeenCalledWith('com.google/gmail', 'gmail');
    expect(await within(itemOf('Gmail')).findByText('Waiting for you…')).toBeInTheDocument();
    await act(async () => finish());
  });

  it('shows Connected for an app the brain already has', async () => {
    open({
      apps: [
        { id: 'com.google/calendar', name: 'Google Calendar', state: 'connected', official: true },
      ],
    });
    await screen.findByText('Gmail');
    await waitFor(() => expect(itemOf('Google Calendar')).toHaveTextContent('Connected'));
    expect(
      within(itemOf('Google Calendar')).queryByRole('button', { name: /Add/ }),
    ).not.toBeInTheDocument();
  });

  it('says in plain words when an app would not connect', async () => {
    const host = open();
    await screen.findByText('Gmail');
    host.setupApp.mockRejectedValue(new Error('denied'));
    fireEvent.click(within(itemOf('Gmail')).getByRole('button', { name: 'Add Gmail' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You said no, so nothing was added.',
    );
  });

  it('the expert row: Add starts the install', async () => {
    const host = open();
    await screen.findByText('Claude Code');
    fireEvent.click(within(itemOf('Claude Code')).getByRole('button', { name: 'Add' }));
    expect(host.setupExpert).toHaveBeenCalledWith('claude-acp');
  });

  it('the expert row: installing shows the percent and what it is doing', async () => {
    open({ progress: { expert: 'claude-acp', stage: 'node', percent: 40 } });
    const claude = await screen.findByText('Claude Code');
    const item = claude.closest('li') as HTMLElement;
    await waitFor(() => expect(item).toHaveTextContent('Installing…'));
    expect(item).toHaveTextContent('40%');
    expect(item).toHaveTextContent('Getting what it needs to run');
  });

  it('the expert row: needs sign-in offers Sign in, which logs in', async () => {
    const host = open({
      experts: [
        { id: 'claude-acp', name: 'Claude Code', version: '2', state: 'needs_login', tested: true },
      ] as SetupOverview['experts'],
    });
    await screen.findByText('Claude Code');
    await waitFor(() => expect(itemOf('Claude Code')).toHaveTextContent('Needs sign-in'));
    expect(itemOf('Claude Code')).toHaveTextContent(
      'Installed. Sign in once with your own account.',
    );
    fireEvent.click(within(itemOf('Claude Code')).getByRole('button', { name: 'Sign in' }));
    expect(host.setupExpert).toHaveBeenCalledWith('claude-acp');
  });

  it('the expert row: ready says Ready', async () => {
    open({
      experts: [
        { id: 'claude-acp', name: 'Claude Code', version: '2', state: 'ready', tested: true },
      ] as SetupOverview['experts'],
    });
    await screen.findByText('Claude Code');
    await waitFor(() => expect(itemOf('Claude Code')).toHaveTextContent('Ready'));
  });

  it('reads again when the brain says setup changed', async () => {
    const host = makeWalkthroughHost();
    let notify: (what: string) => void = () => undefined;
    host.onBrainChanged.mockImplementation((handler: (what: string) => void) => {
      notify = handler;
      return () => undefined;
    });
    host.setupOverview.mockImplementation(() => Promise.resolve(BASE));
    render(<StepTen host={host} />);
    await screen.findByText('Gmail');
    const calls = host.setupOverview.mock.calls.length;
    act(() => notify('setup'));
    await waitFor(() => expect(host.setupOverview.mock.calls.length).toBeGreaterThan(calls));
  });

  it('says so when the brain cannot be read, and still shows no buttons that would fail', async () => {
    const host = makeWalkthroughHost();
    host.setupOverview.mockRejectedValue(new Error('offline'));
    render(<StepTen host={host} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tagalong could not read this. You can connect your tools later in Home, under Connections.',
    );
  });
});

describe('readyOf', () => {
  it('lists connected tour apps and the expert in its state, and nothing else', () => {
    const list = readyOf({
      ...BASE,
      apps: [
        { id: 'com.google/calendar', name: 'Google Calendar', state: 'connected', official: true },
        { id: 'other', name: 'Slack', state: 'connected', official: true },
      ],
      progress: { expert: 'claude-acp', stage: 'node', percent: 10 },
    });
    expect(list).toEqual([
      { name: 'Google Calendar', state: 'connected' },
      { name: 'Claude Code', state: 'installing' },
    ]);
  });

  it('a ready expert is Connected, one that needs a login says so', () => {
    const expert = (state: 'ready' | 'needs_login') =>
      ({
        ...BASE,
        experts: [{ id: 'claude-acp', name: 'Claude Code', version: '2', state, tested: true }],
      }) as SetupOverview;
    expect(readyOf(expert('ready'))).toEqual([{ name: 'Claude Code', state: 'connected' }]);
    expect(readyOf(expert('needs_login'))).toEqual([{ name: 'Claude Code', state: 'signin' }]);
  });

  it('is empty when nothing was connected', () => {
    expect(readyOf(BASE)).toEqual([]);
  });
});
