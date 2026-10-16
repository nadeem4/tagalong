/** Tests for the pet IPC: switching Scout's brain and finishing Welcome. */

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
    roleId: 'companion',
    model: 'anthropic/claude-haiku-4.5',
    providerId: 'openrouter',
  });

const SCOUT = pet('scout');
const SETTINGS = {
  defaultPetId: 'scout',
  welcome: { done: false, step: 'keys', answerBy: 'type', brain: 'claude-code' },
} as Settings;
const FINISHED = { done: true, step: 'try', answerBy: 'type', brain: 'claude-code' } as const;
const CLAUDE: FoundAgent = { id: 'claude-code', label: 'Claude Code', found: true, canThink: true };

function setup(answers: Partial<Record<HostToCoreMethod, unknown>> = {}) {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'pets.list': { pets: [SCOUT, pet('sage')] },
    'pets.upsert': { pet: SCOUT },
    'experts.list': { experts: [] },
    'settings.set': { settings: { ...SETTINGS, welcome: FINISHED } },
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
  it('lists pets', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listPets)).toEqual([SCOUT, pet('sage')]);
    expect(calls).toEqual([['pets.list', {}]]);
  });

  it('saves a pet, redrawing the strip after', async () => {
    const { invoke, calls, deps } = setup();
    expect(await invoke(IPC.savePet, SCOUT)).toEqual(SCOUT);
    expect(calls).toEqual([['pets.upsert', { pet: SCOUT }]]);
    expect(deps.refreshStrip).toHaveBeenCalledOnce();
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

  it('finishes Welcome: keeps the setup record and marks it done, Scout docks alone, then hello', async () => {
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
      ['settings.set', { patch: { hiddenPets, welcome: FINISHED } }],
    ]);
    expect(deps.setSettings).toHaveBeenCalledWith({ ...SETTINGS, welcome: FINISHED });
    expect(order).toEqual(['setSettings', 'refreshStrip', 'welcomed']);
  });
});
