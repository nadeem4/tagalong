import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { OfficeView } from './office-view';

const pet = (id: string, name: string, color?: string): Pet => ({
  id,
  name,
  avatar: '🐾',
  ...(color !== undefined ? { color } : {}),
  persona: '',
  model: 'fake',
  providerId: 'fake',
  toolAllowlist: [],
  replyStyle: 'text',
});

const CREW: Pet[] = [
  pet('scout', 'Scout'),
  pet('ink', 'Ink'),
  pet('bolt', 'Bolt'),
  pet('sage', 'Sage', '#5dbb63'),
];
const T1 = '10000000-0000-4000-8000-000000000001';

async function renderOffice(bridge: FakeHostBridge = createFakeHostBridge({ pets: CREW })) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <OfficeView />
    </HostBridgeProvider>,
  );
  await screen.findByRole('button', { name: /Scout/ });
  return bridge;
}

function partyRow(name: string): HTMLElement {
  return within(screen.getByRole('navigation', { name: 'Party' })).getByRole('button', {
    name: new RegExp(name),
  });
}

describe('OfficeView', () => {
  it('lists the whole crew in the party with job labels and an at-desk status', async () => {
    await renderOffice();
    const party = screen.getByRole('navigation', { name: 'Party' });
    expect(party).toHaveTextContent('PARTY · 4');
    expect(partyRow('Scout')).toHaveTextContent('GENERALIST');
    expect(partyRow('Ink')).toHaveTextContent('WRITER');
    expect(partyRow('Bolt')).toHaveTextContent('BACKEND ENGINEER');
    expect(partyRow('Sage')).toHaveTextContent('CREW');
    for (const name of ['Scout', 'Ink', 'Bolt', 'Sage']) {
      expect(partyRow(name)).toHaveTextContent('At desk');
    }
  });

  it('puts every pet at a named desk on the office floor', async () => {
    await renderOffice();
    const floor = screen.getByRole('region', { name: 'Office floor' });
    for (const name of ['SCOUT', 'INK', 'BOLT', 'SAGE']) expect(floor).toHaveTextContent(name);
  });

  it('shows a pet working, with its monitor lit, while its turn is in flight', async () => {
    const bridge = await renderOffice();
    act(() => bridge.emit({ type: 'turn.started', turnId: T1, petId: 'ink', conversationId: T1 }));
    expect(partyRow('Ink')).toHaveTextContent('Working');
    expect(screen.getByTestId('monitor-ink')).toHaveAttribute('data-lit', 'true');
    expect(screen.getByTestId('monitor-scout')).toHaveAttribute('data-lit', 'false');

    act(() =>
      bridge.emit({
        type: 'turn.completed',
        turnId: T1,
        text: 'done',
        stopReason: 'end',
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    );
    expect(partyRow('Ink')).toHaveTextContent('At desk');
    expect(screen.getByTestId('monitor-ink')).toHaveAttribute('data-lit', 'false');
  });

  it('selects the first pet, and moves the selection and the cursor on click', async () => {
    await renderOffice();
    expect(partyRow('Scout')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('office-cursor')).toHaveAttribute('data-pet-id', 'scout');

    fireEvent.click(partyRow('Bolt'));
    expect(partyRow('Bolt')).toHaveAttribute('aria-pressed', 'true');
    expect(partyRow('Scout')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('office-cursor')).toHaveAttribute('data-pet-id', 'bolt');
  });

  it('shows both rooms free and an empty meetings panel that says what will appear', async () => {
    await renderOffice();
    expect(screen.getByText('2 of 2 rooms free')).toBeInTheDocument();
    const floor = screen.getByRole('region', { name: 'Office floor' });
    expect(within(floor).getAllByText('Free')).toHaveLength(2);
    const meetings = screen.getByRole('complementary', { name: 'Meetings' });
    expect(meetings).toHaveTextContent('When pets meet, their meetings appear here');
  });

  it('shows task assignment as not yet available rather than pretending', async () => {
    await renderOffice();
    const field = screen.getByLabelText('Assign a task');
    expect(field).toBeDisabled();
    const assign = screen.getByRole('button', { name: 'Assign' });
    expect(assign).toBeDisabled();
    expect(assign).toHaveAttribute('title', 'Task assignment arrives in a later update');
    expect(field.closest('[title]')).toHaveAttribute(
      'title',
      'Task assignment arrives in a later update',
    );
  });

  it('says so when the crew cannot be reached', async () => {
    const bridge = createFakeHostBridge({ pets: CREW });
    bridge.listPets = () => Promise.reject(new Error('engine down'));
    render(
      <HostBridgeProvider bridge={bridge}>
        <OfficeView />
      </HostBridgeProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the crew');
  });
});
