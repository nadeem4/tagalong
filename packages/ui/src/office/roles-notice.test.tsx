import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Pet, Role, RolesUpgradeNotice } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge, type FakeHostBridge } from '../test-support/fake-host-bridge';
import { OfficeView } from './office-view';
import { whatHappened } from './roles-notice';
import { officeTokens } from './tokens';

const pet = (id: string, name: string, roleId: string): Pet => ({
  id,
  name,
  avatar: '🐾',
  roleId,
  roleVersion: 1,
  model: 'fake',
  providerId: 'fake',
  toolGrants: {},
  replyStyle: 'text',
});

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

const CREW = [
  pet('scout', 'Scout', 'generalist'),
  pet('bolt', 'Bolt', 'backend-engineer'),
  pet('nova', 'Nova', 'generalist'),
];
const ROLES = [role('generalist', 'Generalist'), role('backend-engineer', 'Backend engineer')];

const NOTICE: RolesUpgradeNotice = {
  pets: [
    { petId: 'bolt', name: 'Bolt', roleId: 'backend-engineer', keptNotes: true, madeByYou: false },
    { petId: 'nova', name: 'Nova', roleId: 'generalist', keptNotes: true, madeByYou: true },
    { petId: 'scout', name: 'Scout', roleId: 'generalist', keptNotes: false, madeByYou: false },
  ],
};

async function renderOffice(bridge: FakeHostBridge, onReviewCrew?: () => void) {
  render(
    <HostBridgeProvider bridge={bridge}>
      <OfficeView {...(onReviewCrew !== undefined ? { onReviewCrew } : {})} />
    </HostBridgeProvider>,
  );
  await screen.findByText('PARTY · 3');
}

const withNotice = () => createFakeHostBridge({ pets: CREW, roles: ROLES, rolesNotice: NOTICE });

describe('whatHappened', () => {
  it('says what the upgrade did to each kind of pet', () => {
    const row = NOTICE.pets[2]!;
    expect(whatHappened(row)).toBe('Default persona replaced by the role.');
    expect(whatHappened({ ...row, keptNotes: true })).toBe('Your edited persona is kept as notes.');
    expect(whatHappened({ ...row, madeByYou: true, keptNotes: true })).toBe(
      'A pet you made. Your persona is kept as notes; pick a better role any time.',
    );
    expect(whatHappened({ ...row, madeByYou: true })).toBe(
      'A pet you made; pick a better role any time.',
    );
  });
});

describe('the roles notice in the office', () => {
  it('stays away on a fresh install', async () => {
    await renderOffice(createFakeHostBridge({ pets: CREW, roles: ROLES }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens over the office with a row per upgraded pet', async () => {
    await renderOffice(withNotice(), () => {});
    const dialog = await screen.findByRole('dialog', { name: 'Your crew has roles now' });

    expect(dialog).toHaveTextContent(/Every pet now has one job/);
    const bolt = within(dialog).getByRole('row', { name: /Bolt/ });
    expect(bolt).toHaveTextContent('BACKEND ENGINEER');
    expect(bolt).toHaveTextContent('Your edited persona is kept as notes.');
    expect(within(bolt).getByText('BACKEND ENGINEER')).toHaveStyle({
      color: officeTokens.roleInk['backend-engineer'],
    });
    expect(within(dialog).getByRole('row', { name: /Nova/ })).toHaveTextContent(
      'pick a better role any time',
    );
    expect(within(dialog).getByRole('row', { name: /Scout/ })).toHaveTextContent(
      'Default persona replaced by the role.',
    );
  });

  it('puts focus on Got it when it opens', async () => {
    await renderOffice(withNotice());
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Got it' })).toHaveFocus(),
    );
  });

  it('explains what changed behind a disclosure', async () => {
    await renderOffice(withNotice());
    const dialog = await screen.findByRole('dialog');
    const more = within(dialog).getByRole('button', { name: 'What changed?' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(within(dialog).queryByText(/Instructions/)).not.toBeInTheDocument();

    fireEvent.click(more);

    expect(within(dialog).getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(dialog).toHaveTextContent(/Instructions now come from the role/);
    expect(dialog).toHaveTextContent(/Models are unchanged/);
    expect(dialog).toHaveTextContent(/Tools are now per role/);
  });

  it('Got it dismisses the notice for good', async () => {
    const bridge = withNotice();
    await renderOffice(bridge);
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.dismissedNotices).toBe(1);
  });

  it('Escape dismisses it like Got it', async () => {
    const bridge = withNotice();
    await renderOffice(bridge);
    const dialog = await screen.findByRole('dialog');

    fireEvent(dialog, new Event('cancel', { cancelable: true }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(bridge.dismissedNotices).toBe(1);
  });

  it('Review my crew dismisses it and hands over to the host', async () => {
    const bridge = withNotice();
    const review = vi.fn();
    await renderOffice(bridge, review);
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Review my crew' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(review).toHaveBeenCalledTimes(1);
    expect(bridge.dismissedNotices).toBe(1);
  });

  it('offers no Review button when the host has nowhere to send the user', async () => {
    await renderOffice(withNotice());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('button', { name: 'Review my crew' })).toBeNull();
  });
});
