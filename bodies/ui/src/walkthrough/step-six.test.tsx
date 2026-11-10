/**
 * Tests for step 6: the everyday jobs and their Connect, and Claude Code's setup behind the
 * optional expert line.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SetupOverview } from '../shapes';
import { JOB_KINDS } from '../jobs-kinds';
import { StepSix } from './step-six';
import { makeWalkthroughHost } from './test-host';

const EMPTY: SetupOverview = {
  experts: [],
  apps: [],
  browseExperts: [
    { id: 'claude-acp', name: 'Claude Code', version: '2', description: 'd', official: false },
  ],
  browseApps: [],
  popular: [],
  appGroups: [],
  nextCursor: null,
  sources: null,
  stale: false,
  progress: null,
  failed: null,
};
const READY: SetupOverview = {
  ...EMPTY,
  experts: [
    {
      id: 'claude-acp',
      name: 'Claude Code',
      version: '2',
      state: 'ready',
      tested: true,
      official: false,
    },
  ],
  browseExperts: [],
};

const EXPERT_LINE = 'For long jobs, Scout can also use an expert';
const GMAIL = {
  id: 'io.example/gmail',
  name: 'Gmail',
  version: '1',
  description: 'd',
  official: false,
};

/** Renders the step and opens the optional expert line, where Claude Code's setup lives. */
async function renderOpen(host: ReturnType<typeof hostWith>) {
  const view = render(<StepSix host={host} />);
  fireEvent.click(await screen.findByRole('button', { name: EXPERT_LINE }));
  return view;
}

/** The registry answers a search by name, as the brain does; no query is its unrelated first page. */
function hostWith(overview: SetupOverview, registry: SetupOverview['browseApps'] = []) {
  const host = makeWalkthroughHost();
  host.setupOverview.mockImplementation((query?: string) =>
    Promise.resolve({
      ...overview,
      browseApps: registry.filter(
        (a) => query !== undefined && a.name.toLowerCase().includes(query),
      ),
    }),
  );
  return host;
}

describe('StepSix', () => {
  it('Set up Claude Code calls setupExpert once, even when pressed twice', async () => {
    const host = hostWith(EMPTY);
    await renderOpen(host);
    const button = await screen.findByRole('button', { name: 'Set up Claude Code' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(host.setupExpert).toHaveBeenCalledTimes(1));
    expect(host.setupExpert).toHaveBeenCalledWith('claude-acp');
  });

  it('disables the button while the press is in flight, and frees it after', async () => {
    const host = hostWith(EMPTY);
    let finish: () => void = () => undefined;
    host.setupExpert.mockReturnValue(
      new Promise<{ state?: string }>((resolve) => (finish = () => resolve({}))),
    );
    await renderOpen(host);
    const button = await screen.findByRole('button', { name: 'Set up Claude Code' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('says the press is the OK, Tagalong’s own Node included', async () => {
    await renderOpen(hostWith(EMPTY));
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(screen.getByText(/own copy of Node/)).toBeVisible();
  });

  it('sets nothing up until the button is pressed; the tour’s Next skips it', async () => {
    const host = hostWith(EMPTY);
    await renderOpen(host);
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(host.setupExpert).not.toHaveBeenCalled();
  });

  it('shows progress while installing and no button to press again', async () => {
    const host = hostWith({
      ...EMPTY,
      progress: { expert: 'claude-acp', stage: 'node', percent: 40 },
    });
    await renderOpen(host);
    expect(await screen.findByText(/Getting Tagalong’s own Node/)).toBeVisible();
    expect(screen.getByText(/40%/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Set up Claude Code' })).not.toBeInTheDocument();
  });

  it('reads again when the brain says setup changed, and shows ready', async () => {
    const host = hostWith(EMPTY);
    let changed: (what: string) => void = () => undefined;
    host.onBrainChanged.mockImplementation((handler) => {
      changed = handler;
      return () => undefined;
    });
    await renderOpen(host);
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    host.setupOverview.mockResolvedValue(READY);
    act(() => changed('setup'));
    expect(await screen.findByText(/Claude Code is set up/)).toBeVisible();
  });

  it('a Claude Code that needs a login offers to log in', async () => {
    const host = hostWith({
      ...READY,
      experts: [{ ...READY.experts[0]!, state: 'needs_login' }],
    });
    await renderOpen(host);
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to Claude Code' }));
    await waitFor(() => expect(host.setupExpert).toHaveBeenCalledWith('claude-acp'));
  });

  it('a login that is waiting says where to finish it, and a reload clears it', async () => {
    const host = hostWith({
      ...READY,
      experts: [{ ...READY.experts[0]!, state: 'needs_login' }],
    });
    host.setupExpert.mockResolvedValue({ state: 'waiting' });
    let changed: (what: string) => void = () => undefined;
    host.onBrainChanged.mockImplementation((handler) => {
      changed = handler;
      return () => undefined;
    });
    await renderOpen(host);
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to Claude Code' }));
    expect(await screen.findByText(/Finish logging in in the window that opened/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Log in to Claude Code' })).toBeNull();
    host.setupOverview.mockResolvedValue(READY);
    act(() => changed('setup'));
    expect(await screen.findByText(/Claude Code is set up/)).toBeVisible();
    expect(screen.queryByText(/Finish logging in/)).toBeNull();
  });

  it('a login that was already done reloads to ready', async () => {
    const host = hostWith({
      ...READY,
      experts: [{ ...READY.experts[0]!, state: 'needs_login' }],
    });
    host.setupExpert.mockImplementation(() => {
      host.setupOverview.mockResolvedValue(READY);
      return Promise.resolve({ state: 'logged_in' });
    });
    await renderOpen(host);
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to Claude Code' }));
    expect(await screen.findByText(/Claude Code is set up/)).toBeVisible();
  });

  it('a failed install shows its reason in the step’s words and a retry', async () => {
    const host = hostWith({ ...EMPTY, failed: { expert: 'claude-acp', error: 'integrity' } });
    await renderOpen(host);
    expect(await screen.findByText(/checksum/)).toBeVisible();
    expect(screen.queryByText('integrity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(host.setupExpert).toHaveBeenCalledTimes(1));
  });

  it('a refused press shows a retry', async () => {
    const host = hostWith(EMPTY);
    host.setupExpert.mockRejectedValue(new Error('no_build'));
    await renderOpen(host);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Claude Code' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('says so when the brain cannot answer', async () => {
    const host = makeWalkthroughHost();
    host.setupOverview.mockRejectedValue(new Error('offline'));
    await renderOpen(host);
    await waitFor(() =>
      expect(screen.getByText(/Scout’s brain is not running/)).toBeInTheDocument(),
    );
  });

  it('shows no npm command anywhere and never claims the login works', async () => {
    const { container } = await renderOpen(hostWith(EMPTY));
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(container.textContent).not.toMatch(/npm install|logged in|login works|signed in/i);
    expect(screen.getByText(/runs on your own Claude login, not the API key/)).toBeInTheDocument();
  });

  it('heading is about everyday jobs and shows the hand-off preview', async () => {
    await renderOpen(hostWith(EMPTY));
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(screen.getByRole('heading', { name: 'Scout does the everyday jobs' })).toBeVisible();
    expect(screen.getByText('Hand this to Claude Code?')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(JOB_KINDS.length + 3);
  });

  it('says more experts are coming, without a list of future ones', async () => {
    await renderOpen(hostWith(EMPTY));
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(screen.getByText('More experts are coming.')).toBeInTheDocument();
    for (const gone of ['Gemini CLI', 'Codex', 'Coming soon', 'Later']) {
      expect(screen.queryByText(gone, { exact: false })).not.toBeInTheDocument();
    }
  });

  it('lists the everyday jobs and never names Claude Code until the expert line is opened', async () => {
    const { container } = render(<StepSix host={hostWith(EMPTY)} />);
    await screen.findByRole('button', { name: EXPERT_LINE });
    for (const job of JOB_KINDS) expect(screen.getByText(job.label)).toBeVisible();
    expect(container.textContent).not.toMatch(/Claude Code/);
    expect(screen.getByRole('button', { name: EXPERT_LINE })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: EXPERT_LINE }));
    expect(screen.getByRole('button', { name: EXPERT_LINE })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Claude Code' })).toBeVisible();
  });

  it('Connect runs the host call for the app the job needs, with progress', async () => {
    const host = hostWith(EMPTY, [GMAIL]);
    let finish: () => void = () => undefined;
    host.setupApp.mockReturnValue(new Promise<{ state?: string }>((r) => (finish = () => r({}))));
    render(<StepSix host={host} />);
    const button = await screen.findByRole('button', { name: 'Connect Gmail' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(host.setupApp).toHaveBeenCalledTimes(1);
    expect(host.setupApp).toHaveBeenCalledWith('io.example/gmail', 'gmail');
    expect(await screen.findByText('Connecting Gmail…')).toBeVisible();
    host.setupOverview.mockResolvedValue({
      ...EMPTY,
      apps: [{ id: 'a1', name: 'Gmail', state: 'connected' }],
    });
    await act(async () => finish());
    expect(await screen.findByText('Gmail is connected.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Connect Gmail' })).toBeNull();
  });

  it('a refused Connect says so in plain words and offers it again', async () => {
    const host = hostWith(EMPTY, [GMAIL]);
    host.setupApp.mockRejectedValue(new Error('denied'));
    render(<StepSix host={host} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Gmail' }));
    expect(await screen.findByText(/nothing was added/)).toBeVisible();
    expect(screen.queryByText('denied')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Try Gmail again' })).toBeEnabled();
  });

  it('asks the registry once per job app, by name, and names the button after the match', async () => {
    const host = hostWith(EMPTY, [
      {
        id: 'io.example/cal',
        name: 'Fancy Calendar',
        version: '1',
        description: 'd',
        official: false,
      },
    ]);
    render(<StepSix host={host} />);
    expect(await screen.findByRole('button', { name: 'Connect Fancy Calendar' })).toBeVisible();
    const queries = host.setupOverview.mock.calls.map(([q]) => q).filter((q) => q !== undefined);
    expect(queries.sort()).toEqual(['calendar', 'gmail']);
  });

  it('an app that is saved but not signed in says to finish in Home, not connected', async () => {
    const host = hostWith({
      ...EMPTY,
      apps: [{ id: 'a1', name: 'Gmail', state: 'needs_sign_in' }],
    });
    render(<StepSix host={host} />);
    expect(await screen.findByText('Finish Gmail in Home.')).toBeVisible();
    expect(screen.queryByText('Gmail is connected.')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Connect/ })).toBeNull();
  });

  it('an app the registry does not have shows no Connect button', async () => {
    render(<StepSix host={hostWith(EMPTY)} />);
    await screen.findByRole('button', { name: EXPERT_LINE });
    expect(screen.queryByRole('button', { name: /^Connect/ })).toBeNull();
  });
});
