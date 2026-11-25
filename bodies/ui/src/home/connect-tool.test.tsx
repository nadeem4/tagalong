/**
 * Tests for ConnectToolDialog: the two ways for each of the three tools, setting one up through
 * the brain (working, connected, failed), and showing the steps with the link hidden until asked.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { ConnectToolDialog } from './connect-tool';

afterEach(cleanup);

function open() {
  const host = createFakeHostBridge();
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<ConnectToolDialog host={host} onClose={onClose} onDone={onDone} />);
  return { host, onClose, onDone };
}

describe('ConnectToolDialog', () => {
  it.each(['Claude Code', 'Codex', 'Cursor'])('offers both ways for %s, named for it', (name) => {
    open();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
    expect(screen.getByText(`Scout adds itself to ${name}'s settings on this PC.`)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Set it up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show me' })).toBeInTheDocument();
  });

  it('sets the chosen tool up and says what it can and cannot do', async () => {
    const { host, onDone } = open();
    fireEvent.click(screen.getByRole('button', { name: /Cursor/ }));
    host.aiToolOutcome = {
      ok: true,
      text: 'Cursor can now ask Scout what it remembers and add notes to it.',
    };
    fireEvent.click(screen.getByRole('button', { name: 'Set it up' }));
    expect(screen.getByRole('heading', { name: 'Connecting Cursor' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Cursor is connected' })).toBeInTheDocument();
    expect(
      screen.getByText('Cursor can now ask Scout what it remembers and add notes to it.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Run your apps, see your screen/)).toBeInTheDocument();
    expect(host.aiToolCalls).toEqual(['cursor']);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('says why it failed, and Try again runs it again', async () => {
    const { host } = open();
    host.aiToolOutcome = { ok: false, message: 'Claude Code is not installed on this PC.' };
    fireEvent.click(screen.getByRole('button', { name: 'Set it up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Claude Code is not installed');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(host.aiToolCalls).toEqual(['claude-code', 'claude-code']));
  });

  it('shows the steps for the tool with the link hidden until asked, and copies the real one either way', async () => {
    const { host } = open();
    fireEvent.click(screen.getByRole('button', { name: /Codex/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    expect(await screen.findByText(/codex mcp add tagalong/)).toBeInTheDocument();
    expect(host.aiToolCalls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy the pairing line' }));
    await waitFor(() =>
      expect(host.copied.at(-1)).toBe(
        'tagalong memory-mcp --pair tagalong://pair?code=codex --client codex',
      ),
    );
    expect(screen.queryByText(/code=codex/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show link' }));
    expect(await screen.findByText(/code=codex/)).toBeInTheDocument();
    expect(host.aiToolCalls).toEqual(['codex']);
  });

  it('makes a new link when the personal-memories switch is turned on', async () => {
    const { host } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    await screen.findByText(/claude mcp add/);
    fireEvent.click(screen.getByRole('button', { name: 'Show link' }));
    await screen.findByText(/code=claude-code/);
    fireEvent.click(screen.getByRole('switch', { name: 'Let it see personal memories' }));
    await waitFor(() => expect(host.aiToolCalls).toEqual(['claude-code', 'claude-code personal']));
  });

  it('says what to turn on when the brain does not listen beyond this PC', async () => {
    const { host } = open();
    host.aiToolLinkError = 'network_off';
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Let other devices connect');
  });
});
