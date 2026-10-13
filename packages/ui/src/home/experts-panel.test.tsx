import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Expert } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { ExpertsPanel, expertIdFor } from './experts-panel';

const CLAUDE: Expert = {
  id: 'claude-code',
  name: 'Claude Code',
  goodAt: 'Code in this repo',
  enabled: true,
  connection: { type: 'claude-code', canEdit: false },
};

function renderPanel(bridge: FakeHostBridge) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <ExpertsPanel />
    </HostBridgeProvider>,
  );
}

describe('ExpertsPanel', () => {
  it('says what experts are when there are none, and offers to add one', async () => {
    renderPanel(createFakeHostBridge());
    expect(await screen.findByText(/No experts yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add expert' })).toBeInTheDocument();
  });

  it('lists each expert, and whether it is on and may edit, in words', async () => {
    renderPanel(
      createFakeHostBridge({
        experts: [CLAUDE, { ...CLAUDE, id: 'docs', name: 'Docs helper', enabled: false }],
      }),
    );
    const list = await screen.findByRole('list', { name: 'Experts' });
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Claude Code');
    expect(rows[0]).toHaveTextContent('Asks which project for each task');
    expect(rows[0]).toHaveTextContent('On');
    expect(rows[0]).toHaveTextContent('Reads only');
    expect(rows[1]).toHaveTextContent('Off');
  });

  it('adds a Claude Code expert, saves it, and tests the connection', async () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Claude Code');
    fireEvent.change(screen.getByLabelText('Good at'), {
      target: { value: 'Code changes and tests' },
    });
    expect(screen.queryByLabelText(/project folder/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Claude Code is ready.');
    expect(bridge.experts).toEqual([
      {
        id: 'claude-code',
        name: 'Claude Code',
        goodAt: 'Code changes and tests',
        enabled: true,
        connection: { type: 'claude-code', canEdit: false },
      },
    ]);
    expect(bridge.testedExperts).toEqual(['claude-code']);
  });

  it('says plainly when the expert cannot be reached, but keeps it saved', async () => {
    const bridge = createFakeHostBridge({
      testExpert: () => ({ ok: false, error: '"claude" was not found on the PATH.' }),
    });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved, but Claude Code cannot be reached: "claude" was not found on the PATH.',
    );
    expect(bridge.experts).toHaveLength(1);
  });

  it('saves without a folder: the project is chosen for each task', async () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Claude Code is ready.');
    expect(bridge.experts[0]?.connection).toEqual({ type: 'claude-code', canEdit: false });
  });

  it('drops a default folder an old expert still carries when it is saved again', async () => {
    const bridge = createFakeHostBridge({
      experts: [
        { ...CLAUDE, connection: { type: 'claude-code', folder: 'C:\\old', canEdit: false } },
      ],
    });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    await screen.findByRole('status');
    expect(bridge.experts[0]?.connection).toEqual({ type: 'claude-code', canEdit: false });
  });

  it('edits an expert: lets it edit files and switches it off', async () => {
    const bridge = createFakeHostBridge({ experts: [CLAUDE] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    const edit = screen.getByRole('switch', { name: 'Let it edit files by default' });
    expect(edit).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(edit);
    expect(edit).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('switch', { name: 'On' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    await screen.findByRole('status');
    expect(bridge.experts[0]).toMatchObject({
      id: 'claude-code',
      enabled: false,
      connection: { canEdit: true },
    });
  });

  it('deletes an expert after asking once', async () => {
    const bridge = createFakeHostBridge({ experts: [CLAUDE] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Claude Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Claude Code for good' }));
    expect(await screen.findByText(/No experts yet/)).toBeInTheDocument();
    expect(bridge.experts).toEqual([]);
  });
});

describe('expertIdFor', () => {
  it('makes a kebab-case id from the name, unique among the others', () => {
    expect(expertIdFor('Claude Code', [])).toBe('claude-code');
    expect(expertIdFor('Claude Code', ['claude-code'])).toBe('claude-code-2');
    expect(expertIdFor('  ', [])).toBe('expert');
  });
});
