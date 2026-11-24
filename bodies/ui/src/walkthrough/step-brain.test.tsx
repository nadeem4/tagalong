/** Tests for step 1: the three places the brain can live, the pairing screens and their errors. */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StepBrain } from './step-brain';
import { makeWalkthroughHost, mountStep } from './test-host';
import type { PairOutcome } from '../shapes';

const LINK = `tagalong://pair?addr=192.168.1.20:47323&fp=${'ab'.repeat(32)}&code=xyz`;

function open(options: Parameters<typeof makeWalkthroughHost>[0] = {}) {
  const host = makeWalkthroughHost(options);
  const onBlock = vi.fn();
  const onShare = vi.fn();
  const onPaired = vi.fn();
  const step = mountStep(
    <StepBrain host={host} onBlock={onBlock} onShare={onShare} onPaired={onPaired} />,
  );
  return { host, onBlock, onShare, onPaired, step };
}

async function enterLink(text: string): Promise<void> {
  fireEvent.change(await screen.findByLabelText('Pairing link'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Pair' }));
}

describe('StepBrain', () => {
  it('offers the three places and starts on this computer, not blocking Next', () => {
    const { onBlock } = open();
    expect(screen.getByRole('radio', { name: /On this computer/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /On another computer/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /On a server I’ll set up/ })).not.toBeChecked();
    expect(onBlock).toHaveBeenLastCalledWith(false);
  });

  it('saves nothing without the switch; with it on, installs the service and tells the shell', async () => {
    const { host, onShare, step } = open();
    await step.save();
    expect(host.installBrainService).not.toHaveBeenCalled();
    expect(onShare).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('switch', { name: /Keep it on for my other devices/ }));
    expect(onShare).toHaveBeenLastCalledWith(true);
    await step.save();
    expect(host.installBrainService).toHaveBeenCalledTimes(1);
  });

  it('looks for nearby brains only once another computer is chosen', () => {
    const { host } = open();
    expect(host.discoverBrains).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: /On another computer/ }));
    expect(host.discoverBrains).toHaveBeenCalledTimes(1);
  });

  it('lists brains found nearby and fills in the one picked', async () => {
    open({ found: [{ name: 'mini-pc', addr: '192.168.1.20:47323' }] });
    fireEvent.click(screen.getByRole('radio', { name: /On another computer/ }));
    expect(await screen.findByText('mini-pc')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pair with mini-pc' }));
    expect(screen.getByText(/Paste the pairing link from mini-pc/)).toBeInTheDocument();
  });

  it('pairs with the link, says so, and lets Next through', async () => {
    const { host, onBlock, onPaired } = open();
    fireEvent.click(screen.getByRole('radio', { name: /On another computer/ }));
    expect(onBlock).toHaveBeenLastCalledWith(true);
    await enterLink(LINK);
    expect(host.pairWithLink).toHaveBeenCalledWith(LINK);
    expect(await screen.findByText('Paired with 192.168.1.20')).toBeInTheDocument();
    expect(onPaired).toHaveBeenCalledWith('192.168.1.20');
    await waitFor(() => expect(onBlock).toHaveBeenLastCalledWith(false));
  });

  it.each<[Extract<PairOutcome, { ok: false }>['reason'], RegExp]>([
    ['refused', /expired or was already used/],
    ['wrong_brain', /not the computer that made this link. Nothing was sent/],
    ['unreachable', /Can’t reach 192\.168\.1\.20/],
    ['bad_link', /isn’t a Scout pairing link/],
    ['cannot_seal', /could not secure the pairing/],
  ])('shows the line for a %s failure and keeps Next blocked', async (reason, line) => {
    const { onBlock } = open({ pair: { ok: false, reason } });
    fireEvent.click(screen.getByRole('radio', { name: /On another computer/ }));
    await enterLink(LINK);
    expect(await screen.findByRole('alert')).toHaveTextContent(line);
    expect(onBlock).toHaveBeenLastCalledWith(true);
  });

  it('shows the server install commands per system, then takes the link', async () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: /On a server I’ll set up/ }));
    expect(screen.getByText(/install\.sh \| sh/)).toBeInTheDocument();
    expect(screen.getByText('tagalong serve --install-service')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Windows' }));
    expect(screen.getByText(/install\.ps1 \| iex/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Docker' }));
    expect(screen.getByText(/docker run/)).toBeInTheDocument();
    expect(screen.getByLabelText('Pairing link')).toBeInTheDocument();
  });
});
