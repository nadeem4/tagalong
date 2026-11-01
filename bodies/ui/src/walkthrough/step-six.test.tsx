/** Tests for step 6: the Claude Code check, the install line, and the experts still to come. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StepSix } from './step-six';
import { makeWalkthroughHost } from './test-host';

describe('StepSix', () => {
  it('says the connector is installed when expert_status finds it', async () => {
    render(<StepSix host={makeWalkthroughHost()} />);
    expect(
      await screen.findByText('Claude Code’s connector is installed on this computer.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/npm install/)).not.toBeInTheDocument();
  });

  it('says it was not found and shows the install line', async () => {
    const host = makeWalkthroughHost();
    host.expertStatus.mockResolvedValue({ found: false, command: 'claude-agent-acp' });
    render(<StepSix host={host} />);
    expect(await screen.findByText('Claude Code’s connector was not found.')).toBeInTheDocument();
    expect(screen.getByText('npm install -g @agentclientprotocol/claude-agent-acp')).toBeVisible();
  });

  it('Check again asks the brain again', async () => {
    const host = makeWalkthroughHost();
    host.expertStatus.mockResolvedValueOnce({ found: false, command: 'claude-agent-acp' });
    render(<StepSix host={host} />);
    await screen.findByText('Claude Code’s connector was not found.');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText('Claude Code’s connector is installed on this computer.');
    expect(host.expertStatus).toHaveBeenCalledTimes(2);
  });

  it('never claims the login works', async () => {
    const { container } = render(<StepSix host={makeWalkthroughHost()} />);
    await screen.findByText(/is installed on this computer/);
    expect(container.textContent).not.toMatch(/logged in|login works|signed in/i);
    expect(screen.getByText(/runs on your own Claude login, not the API key/)).toBeInTheDocument();
  });

  it('says so when the brain cannot answer', async () => {
    const host = makeWalkthroughHost();
    host.expertStatus.mockRejectedValue(new Error('offline'));
    render(<StepSix host={host} />);
    await waitFor(() =>
      expect(screen.getByText(/Scout’s brain is not running/)).toBeInTheDocument(),
    );
  });

  it('heading is about bigger jobs and shows the hand-off preview', async () => {
    render(<StepSix host={makeWalkthroughHost()} />);
    await screen.findByText(/is installed/);
    expect(screen.getByText('Bigger jobs')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'For bigger jobs, Scout calls in an expert' }),
    ).toBeVisible();
    expect(screen.getByText('Hand this to Claude Code?')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('says more experts are coming, without a list of future ones', async () => {
    render(<StepSix host={makeWalkthroughHost()} />);
    await screen.findByText(/is installed/);
    expect(screen.getByText('More experts are coming.')).toBeInTheDocument();
    for (const gone of ['Gemini CLI', 'Codex', 'Coming soon', 'Later']) {
      expect(screen.queryByText(gone, { exact: false })).not.toBeInTheDocument();
    }
  });
});
