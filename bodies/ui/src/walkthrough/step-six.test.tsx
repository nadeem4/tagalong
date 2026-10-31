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

  it('lists the experts still to come', async () => {
    render(<StepSix host={makeWalkthroughHost()} />);
    await screen.findByText(/is installed/);
    for (const text of [
      'Gemini CLI',
      'Codex',
      'Other coding agents',
      'Model APIs and tool servers',
    ]) {
      expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Coming soon')).toHaveLength(3);
    expect(screen.getByText('Later')).toBeInTheDocument();
    expect(screen.getByText('Hand this to Claude Code?')).toBeInTheDocument();
    expect(screen.queryByText(/Try it/)).not.toBeInTheDocument();
  });
});
