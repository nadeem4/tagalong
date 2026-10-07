import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pet, Role } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { OFFICE_CSS } from './office-styles';
import { OfficeView } from './office-view';

const pet = (id: string, name: string, roleId: string, color?: string): Pet => ({
  id,
  name,
  avatar: '🐾',
  ...(color !== undefined ? { color } : {}),
  roleId,
  roleVersion: 1,
  model: 'fake',
  providerId: 'fake',
  toolGrants: {},
  replyStyle: 'text',
});

const CREW: Pet[] = [
  pet('scout', 'Scout', 'generalist'),
  pet('ink', 'Ink', 'writer'),
  pet('bolt', 'Bolt', 'backend-engineer'),
  pet('sage', 'Sage', 'wizard', '#5dbb63'),
];

const role = (id: string, name: string): Role => ({
  id,
  name,
  version: 1,
  summary: `${name}.`,
  goodAt: ['things'],
  notFor: ['other things'],
  tools: [],
  model: { tier: 'balanced', needsVision: false },
  instructions: `You are a ${name}.`,
});

const ROLES: Role[] = [
  role('generalist', 'Generalist'),
  role('writer', 'Writer'),
  role('backend-engineer', 'Backend engineer'),
  role('researcher', 'Researcher'),
];
const T1 = '10000000-0000-4000-8000-000000000001';

async function renderOffice(
  bridge: FakeHostBridge = createFakeHostBridge({ pets: CREW, roles: ROLES }),
) {
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
    // Sage's role is not in the library, so it works as a generalist.
    expect(partyRow('Sage')).toHaveTextContent('GENERALIST');
    for (const name of ['Scout', 'Ink', 'Bolt', 'Sage']) {
      expect(partyRow(name)).toHaveTextContent('At desk');
    }
  });

  it('labels a pet by its role, not its id', async () => {
    const crew = [pet('scout', 'Scout', 'researcher'), pet('pip', 'Pip', 'writer')];
    await renderOffice(createFakeHostBridge({ pets: crew, roles: ROLES }));
    expect(partyRow('Scout')).toHaveTextContent('RESEARCHER');
    expect(partyRow('Scout')).not.toHaveTextContent('GENERALIST');
    expect(partyRow('Pip')).toHaveTextContent('WRITER');
  });

  it('still shows the crew when the roles cannot be listed', async () => {
    const bridge = createFakeHostBridge({ pets: CREW, roles: ROLES });
    bridge.listRoles = () => Promise.reject(new Error('old engine'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await renderOffice(bridge);
    expect(partyRow('Ink')).toHaveTextContent('GENERALIST');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
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
    const bridge = createFakeHostBridge({ pets: CREW, roles: ROLES });
    bridge.listPets = () => Promise.reject(new Error('engine down'));
    render(
      <HostBridgeProvider bridge={bridge}>
        <OfficeView />
      </HostBridgeProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the crew');
  });
});

describe('the Still office toggle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const still = () => screen.getByRole('button', { name: 'Still office' });
  const root = () => screen.getByRole('navigation', { name: 'Party' }).closest('.office');

  it('stops the bob and the cursor hop, and remembers the choice', async () => {
    await renderOffice();
    expect(still()).toHaveAttribute('aria-pressed', 'false');
    expect(root()).not.toHaveClass('office-still');

    fireEvent.click(still());
    expect(still()).toHaveAttribute('aria-pressed', 'true');
    expect(root()).toHaveClass('office-still');
    expect(localStorage.getItem('tagalong.office.still')).toBe('1');

    fireEvent.click(still());
    expect(root()).not.toHaveClass('office-still');
    expect(localStorage.getItem('tagalong.office.still')).toBe('0');
  });

  it('opens still when the choice was remembered', async () => {
    localStorage.setItem('tagalong.office.still', '1');
    await renderOffice();
    expect(still()).toHaveAttribute('aria-pressed', 'true');
  });

  it('still toggles when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    await renderOffice();
    fireEvent.click(still());
    expect(still()).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the animations off in the stylesheet', () => {
    expect(OFFICE_CSS).toMatch(
      /\.office-still \.office-bob,\s*\.office-still \.office-hop\s*\{\s*animation: none;/,
    );
  });
});
