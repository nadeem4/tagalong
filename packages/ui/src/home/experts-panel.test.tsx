import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  connection: { type: 'claude-code', folder: 'C:\\projects\\ai_pet', canEdit: false },
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

  it('lists each expert with its folder, and whether it is on and may edit, in words', async () => {
    renderPanel(
      createFakeHostBridge({
        experts: [CLAUDE, { ...CLAUDE, id: 'docs', name: 'Docs helper', enabled: false }],
      }),
    );
    const list = await screen.findByRole('list', { name: 'Experts' });
    const rows = within(list).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Claude Code');
    expect(rows[0]).toHaveTextContent('C:\\projects\\ai_pet');
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
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'C:\\work\\app' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Saved. Claude Code is ready.');
    expect(bridge.experts).toEqual([
      {
        id: 'claude-code',
        name: 'Claude Code',
        goodAt: 'Code changes and tests',
        enabled: true,
        connection: { type: 'claude-code', folder: 'C:\\work\\app', canEdit: false },
      },
    ]);
    expect(bridge.testedExperts).toEqual(['claude-code']);
  });

  it('says plainly when the expert cannot be reached, but keeps it saved', async () => {
    const bridge = createFakeHostBridge({
      testExpert: () => ({ ok: false, error: 'The folder C:\\nope does not exist.' }),
    });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
    fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'C:\\nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Saved, but Claude Code cannot be reached: The folder C:\\nope does not exist.',
    );
    expect(bridge.experts).toHaveLength(1);
  });

  it('needs a folder before it saves', async () => {
    const bridge = createFakeHostBridge();
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the folder');
    expect(bridge.experts).toEqual([]);
  });

  it('fills the folder from the folder picker', async () => {
    const bridge = createFakeHostBridge({ pickFolder: () => 'D:\\code\\site' });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: 'Add expert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose…' }));
    await waitFor(() => expect(screen.getByLabelText('Folder')).toHaveValue('D:\\code\\site'));
  });

  it('edits an expert: lets it edit files and switches it off', async () => {
    const bridge = createFakeHostBridge({ experts: [CLAUDE] });
    renderPanel(bridge);
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Let it edit files/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /On:/ }));
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
