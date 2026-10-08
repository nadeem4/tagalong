import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Pet, Role } from '@tagalong/protocol';
import { HostBridgeProvider } from '../host-bridge';
import { createFakeHostBridge } from '../test-support/fake-host-bridge';
import { AgentControls } from './agent-controls';
import type { AgentHost } from './agent-controls';

const scout: Pet = {
  id: 'scout',
  name: 'Scout',
  avatar: '🐾',
  roleId: 'generalist',
  roleVersion: 1,
  model: 'fake-model',
  providerId: 'fake',
  toolGrants: {},
  replyStyle: 'text',
  notes: 'Likes short answers.',
};

const role = (id: string, name: string, tools: string[] = []): Role => ({
  id,
  name,
  version: 2,
  summary: `${name} summary.`,
  goodAt: ['things'],
  notFor: ['other things'],
  tools,
  model: { tier: 'balanced', needsVision: false },
  instructions: `You are a ${name}.`,
});
const ROLES = [role('generalist', 'Generalist', ['look_at_screen']), role('writer', 'Writer')];
const PROVIDERS = [
  { id: 'fake', label: 'Fake' },
  { id: 'nebius', label: 'Nebius Token Factory' },
];

function fakeHost(): AgentHost & {
  saved: Pet[];
  deleted: string[];
  desktop: string[];
} {
  const host = {
    saved: [] as Pet[],
    deleted: [] as string[],
    desktop: [] as string[],
    setup: () =>
      Promise.resolve({ providers: PROVIDERS, desktopPetId: 'ink', newAgentProviderId: 'fake' }),
    listModels: () => Promise.resolve({ models: ['fake-model'], source: 'fallback' as const }),
    savePet: (pet: Pet) => {
      host.saved.push(pet);
      return Promise.resolve(pet);
    },
    deletePet: (petId: string) => {
      host.deleted.push(petId);
      return Promise.resolve(true);
    },
    setDesktopPet: (petId: string) => {
      host.desktop.push(petId);
      return Promise.resolve();
    },
  };
  return host;
}

function renderControls(
  host = fakeHost(),
  props: {
    desktopPetId?: string;
    onSaved?: (pet: Pet) => void;
    onDeleted?: (id: string) => void;
  } = {},
) {
  const onDesktopPet = vi.fn();
  render(
    <HostBridgeProvider bridge={createFakeHostBridge({ roles: ROLES })}>
      <AgentControls
        pet={scout}
        roles={ROLES}
        providers={PROVIDERS}
        host={host}
        desktopPetId={props.desktopPetId ?? 'ink'}
        onDesktopPet={onDesktopPet}
        onSaved={props.onSaved ?? (() => undefined)}
        onDeleted={props.onDeleted ?? (() => undefined)}
      />
    </HostBridgeProvider>,
  );
  return { host, onDesktopPet };
}

describe('AgentControls', () => {
  it('shows the role picker, brain, tool switches, notes and the directory card', () => {
    renderControls();
    expect(screen.getByRole('radio', { name: 'Generalist' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Writer' })).not.toBeChecked();
    expect(screen.getByLabelText('Model id')).toHaveValue('fake-model');
    expect(screen.getByTestId('brain-chip')).toHaveTextContent('Your choice');
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(screen.getByLabelText('Notes (optional, private)')).toHaveValue('Likes short answers.');
    expect(screen.getByRole('region', { name: 'How teammates see Scout' })).toBeInTheDocument();
  });

  it('saves the edits through the host, and says so', async () => {
    const onSaved = vi.fn();
    const { host } = renderControls(fakeHost(), { onSaved });
    fireEvent.change(screen.getByLabelText('Notes (optional, private)'), {
      target: { value: 'Answers in French.' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Writer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Scout' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    expect(host.saved[0]).toMatchObject({
      id: 'scout',
      roleId: 'writer',
      notes: 'Answers in French.',
      toolGrants: {},
    });
    expect(onSaved).toHaveBeenCalledWith(host.saved[0]);
  });

  it('refuses to save without a model, naming the field', async () => {
    const { host } = renderControls();
    fireEvent.change(screen.getByLabelText('Model id'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Scout' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Scout needs a model id.');
    expect(host.saved).toEqual([]);
  });

  it('drops empty notes rather than saving a blank', async () => {
    const { host } = renderControls();
    fireEvent.change(screen.getByLabelText('Notes (optional, private)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Scout' }));
    await waitFor(() => expect(host.saved).toHaveLength(1));
    expect(host.saved[0]).not.toHaveProperty('notes');
  });

  it('puts the agent on the desktop when asked', async () => {
    const { host, onDesktopPet } = renderControls();
    const section = screen.getByRole('group', { name: 'Desktop pet' });
    fireEvent.click(within(section).getByRole('button', { name: 'Put Scout on the desktop' }));
    await waitFor(() => expect(onDesktopPet).toHaveBeenCalledWith('scout'));
    expect(host.desktop).toEqual(['scout']);
  });

  it('says when the agent already is the desktop pet', () => {
    renderControls(fakeHost(), { desktopPetId: 'scout' });
    const section = screen.getByRole('group', { name: 'Desktop pet' });
    expect(section).toHaveTextContent('Scout is the pet on your desktop.');
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('deletes only after a second, explicit yes', async () => {
    const onDeleted = vi.fn();
    const { host } = renderControls(fakeHost(), { onDeleted });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Scout' }));
    expect(host.deleted).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep Scout' }));
    expect(screen.queryByRole('button', { name: 'Delete Scout for good' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Scout' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Scout for good' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('scout'));
    expect(host.deleted).toEqual(['scout']);
  });
});
