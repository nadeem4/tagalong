/** Tests for step 6: setting up Claude Code from the tour, and the hand-off preview. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SetupOverview } from '../shapes';
import { StepSix } from './step-six';
import { makeWalkthroughHost } from './test-host';

const EMPTY: SetupOverview = {
  experts: [],
  apps: [],
  browseExperts: [{ id: 'claude-acp', name: 'Claude Code', version: '2', description: 'd' }],
  browseApps: [],
  stale: false,
  progress: null,
  failed: null,
};
const READY: SetupOverview = {
  ...EMPTY,
  experts: [{ id: 'claude-acp', name: 'Claude Code', version: '2', state: 'ready', tested: true }],
  browseExperts: [],
};

function hostWith(overview: SetupOverview) {
  const host = makeWalkthroughHost();
  host.setupOverview.mockResolvedValue(overview);
  return host;
}

describe('StepSix', () => {
  it('Set up Claude Code calls setupExpert once, even when pressed twice', async () => {
    const host = hostWith(EMPTY);
    render(<StepSix host={host} />);
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
    render(<StepSix host={host} />);
    const button = await screen.findByRole('button', { name: 'Set up Claude Code' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('says the press is the OK, Tagalong’s own Node included', async () => {
    render(<StepSix host={hostWith(EMPTY)} />);
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(screen.getByText(/own copy of Node/)).toBeVisible();
  });

  it('sets nothing up until the button is pressed; the tour’s Next skips it', async () => {
    const host = hostWith(EMPTY);
    render(<StepSix host={host} />);
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(host.setupExpert).not.toHaveBeenCalled();
  });

  it('shows progress while installing and no button to press again', async () => {
    const host = hostWith({
      ...EMPTY,
      progress: { expert: 'claude-acp', stage: 'node', percent: 40 },
    });
    render(<StepSix host={host} />);
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
    render(<StepSix host={host} />);
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
    render(<StepSix host={host} />);
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
    render(<StepSix host={host} />);
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
    render(<StepSix host={host} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Log in to Claude Code' }));
    expect(await screen.findByText(/Claude Code is set up/)).toBeVisible();
  });

  it('a failed install shows its reason in the step’s words and a retry', async () => {
    const host = hostWith({ ...EMPTY, failed: { expert: 'claude-acp', error: 'integrity' } });
    render(<StepSix host={host} />);
    expect(await screen.findByText(/checksum/)).toBeVisible();
    expect(screen.queryByText('integrity')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(host.setupExpert).toHaveBeenCalledTimes(1));
  });

  it('a refused press shows a retry', async () => {
    const host = hostWith(EMPTY);
    host.setupExpert.mockRejectedValue(new Error('no_build'));
    render(<StepSix host={host} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Claude Code' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('says so when the brain cannot answer', async () => {
    const host = makeWalkthroughHost();
    host.setupOverview.mockRejectedValue(new Error('offline'));
    render(<StepSix host={host} />);
    await waitFor(() =>
      expect(screen.getByText(/Scout’s brain is not running/)).toBeInTheDocument(),
    );
  });

  it('shows no npm command anywhere and never claims the login works', async () => {
    const { container } = render(<StepSix host={hostWith(EMPTY)} />);
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(container.textContent).not.toMatch(/npm install|logged in|login works|signed in/i);
    expect(screen.getByText(/runs on your own Claude login, not the API key/)).toBeInTheDocument();
  });

  it('heading is about bigger jobs and shows the hand-off preview', async () => {
    render(<StepSix host={hostWith(EMPTY)} />);
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(screen.getByText('Bigger jobs')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'For bigger jobs, Scout calls in an expert' }),
    ).toBeVisible();
    expect(screen.getByText('Hand this to Claude Code?')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('says more experts are coming, without a list of future ones', async () => {
    render(<StepSix host={hostWith(EMPTY)} />);
    await screen.findByRole('button', { name: 'Set up Claude Code' });
    expect(screen.getByText('More experts are coming.')).toBeInTheDocument();
    for (const gone of ['Gemini CLI', 'Codex', 'Coming soon', 'Later']) {
      expect(screen.queryByText(gone, { exact: false })).not.toBeInTheDocument();
    }
  });
});
