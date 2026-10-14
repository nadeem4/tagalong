import { describe, expect, it, vi } from 'vitest';
import { getRole } from '@tagalong/core';
import { Pet } from '@tagalong/protocol';
import type { HostToCoreMethod, Settings } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { FoundAgent } from '../../shared/ipc';
import { companionOn, welcomeCrew } from '../welcome';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerCrewIpc } from './crew';

const pet = (id: string): Pet =>
  Pet.parse({
    id,
    name: id,
    avatar: '🐾',
    roleId: 'generalist',
    roleVersion: 1,
    model: 'anthropic/claude-haiku-4.5',
    providerId: 'openrouter',
  });

const SCOUT = pet('scout');
const SETTINGS = { defaultPetId: 'scout' } as Settings;
const CLAUDE: FoundAgent = { id: 'claude-code', label: 'Claude Code', found: true, canThink: true };

function setup(answers: Partial<Record<HostToCoreMethod, unknown>> = {}) {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'pets.list': { pets: [SCOUT, pet('sage')] },
    'pets.upsert': { pet: SCOUT },
    'pets.delete': { deleted: true },
    'roles.list': { roles: [] },
    'roles.recommendModel': { model: 'm' },
    'notices.rolesUpgrade': { notice: null },
    'experts.list': { experts: [] },
    'settings.set': { settings: { ...SETTINGS, welcome: { done: true } } },
    ...answers,
  });
  const order: string[] = [];
  const deps = {
    engine: () => engine.client,
    settings: () => SETTINGS,
    setSettings: vi.fn(() => void order.push('setSettings')),
    refreshStrip: vi.fn(() => void order.push('refreshStrip')),
    findAgents: vi.fn(() => Promise.resolve([CLAUDE])),
    welcomed: vi.fn(() => void order.push('welcomed')),
  };
  registerCrewIpc(ipc.handle, deps);
  return { ...ipc, calls: engine.calls, deps, order };
}

describe('registerCrewIpc', () => {
  it('lists pets and roles, recommends a model and reads the roles notice', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listPets)).toEqual([SCOUT, pet('sage')]);
    expect(await invoke(IPC.listRoles)).toEqual([]);
    expect(await invoke(IPC.recommendModel, 'coder', 'openrouter')).toEqual({ model: 'm' });
    expect(await invoke(IPC.rolesNotice)).toBeNull();
    expect(await invoke(IPC.dismissRolesNotice)).toBeUndefined();
    expect(calls).toEqual([
      ['pets.list', {}],
      ['roles.list', {}],
      ['roles.recommendModel', { roleId: 'coder', providerId: 'openrouter' }],
      ['notices.rolesUpgrade', {}],
      ['notices.dismiss', { notice: 'rolesUpgrade' }],
    ]);
  });

  it('saves and deletes a pet, redrawing the strip after each', async () => {
    const { invoke, calls, deps } = setup();
    expect(await invoke(IPC.savePet, SCOUT)).toEqual(SCOUT);
    expect(await invoke(IPC.deletePet, 'sage')).toBe(true);
    expect(calls).toEqual([
      ['pets.upsert', { pet: SCOUT }],
      ['pets.delete', { petId: 'sage' }],
    ]);
    expect(deps.refreshStrip).toHaveBeenCalledTimes(2);
  });

  it('moves Scout, as the Companion, to the chosen service', async () => {
    const { invoke, calls, deps } = setup();
    expect(await invoke(IPC.switchScout, 'nebius')).toEqual(SCOUT);
    expect(calls[1]).toEqual([
      'pets.upsert',
      { pet: companionOn(SCOUT, 'nebius', getRole('companion')!) },
    ]);
    expect(deps.refreshStrip).toHaveBeenCalledOnce();
  });

  it('refuses to switch a desktop pet that does not exist', async () => {
    const { invoke } = setup({ 'pets.list': { pets: [pet('sage')] } });
    await expect(invoke(IPC.switchScout, 'nebius')).rejects.toThrow('There is no scout to switch.');
  });

  it('finishes Welcome: Scout docks alone, Claude Code becomes an expert, then hello', async () => {
    const { invoke, calls, deps, order } = setup();
    await invoke(IPC.finishWelcome, 'claude-code');
    const companion = getRole('companion')!;
    const { scout, hiddenPets } = welcomeCrew(
      [SCOUT, pet('sage')],
      'scout',
      'claude-code',
      companion,
    );
    expect(calls).toEqual([
      ['pets.list', {}],
      ['pets.upsert', { pet: scout }],
      ['experts.list', {}],
      ['experts.upsert', { expert: expect.objectContaining({ id: 'claude-code' }) }],
      ['settings.set', { patch: { hiddenPets, welcome: { done: true } } }],
    ]);
    expect(deps.setSettings).toHaveBeenCalledWith({ ...SETTINGS, welcome: { done: true } });
    expect(order).toEqual(['setSettings', 'refreshStrip', 'welcomed']);
  });
});
