/** Tests for the pet IPC: switching Scout's brain and finishing Welcome. */

import { describe, expect, it, vi } from 'vitest';
import { getRole } from '@tagalong/core';
import { Pet } from '@tagalong/protocol';
import type { HostToCoreMethod, Settings } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { FoundAgent } from '../../shared/ipc';
import { companionOn } from '../welcome';
import { fakeEngine, fakeIpc } from './fake-ipc';
import { registerScoutIpc } from './scout';

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
  welcome: { done: false, step: 'keys', answerBy: 'type', brain: 'claude-code' },
} as Settings;
const FINISHED = { done: true, step: 'try', answerBy: 'type', brain: 'claude-code' } as const;
const CLAUDE: FoundAgent = { id: 'claude-code', label: 'Claude Code', found: true, canThink: true };

function setup(answers: Partial<Record<HostToCoreMethod, unknown>> = {}) {
  const ipc = fakeIpc();
  const engine = fakeEngine({
    'pets.list': { pets: [SCOUT] },
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
    reloadAvatar: vi.fn(() => void order.push('reloadAvatar')),
    findAgents: vi.fn(() => Promise.resolve([CLAUDE])),
    welcomed: vi.fn(() => void order.push('welcomed')),
  };
  registerScoutIpc(ipc.handle, deps);
  return { ...ipc, calls: engine.calls, deps, order };
}

describe('registerScoutIpc', () => {
  it('lists pets', async () => {
    const { invoke, calls } = setup();
    expect(await invoke(IPC.listPets)).toEqual([SCOUT]);
    expect(calls).toEqual([['pets.list', {}]]);
  });

  it('saves Scout, reloading its window after', async () => {
    const { invoke, calls, deps } = setup();
    expect(await invoke(IPC.savePet, SCOUT)).toEqual(SCOUT);
    expect(calls).toEqual([['pets.upsert', { pet: SCOUT }]]);
    expect(deps.reloadAvatar).toHaveBeenCalledOnce();
  });

  it('moves Scout, as the Companion, to the chosen service', async () => {
    const { invoke, calls, deps } = setup();
    expect(await invoke(IPC.switchScout, 'openrouter')).toEqual(SCOUT);
    expect(calls[1]).toEqual([
      'pets.upsert',
      { pet: companionOn(SCOUT, 'openrouter', getRole('companion')!) },
    ]);
    expect(deps.reloadAvatar).toHaveBeenCalledOnce();
  });

  it('refuses to switch when there is no Scout', async () => {
    const { invoke } = setup({ 'pets.list': { pets: [] } });
    await expect(invoke(IPC.switchScout, 'openrouter')).rejects.toThrow(
      'There is no Scout to switch.',
    );
  });

  it('refuses to finish Welcome when there is no Scout', async () => {
    const { invoke, deps } = setup({ 'pets.list': { pets: [] } });
    await expect(invoke(IPC.finishWelcome, 'claude-code')).rejects.toThrow(
      'There is no Scout to welcome.',
    );
    expect(deps.welcomed).not.toHaveBeenCalled();
  });

  it('finishes Welcome: Scout on the chosen brain, the setup record marked done, then hello', async () => {
    const { invoke, calls, deps, order } = setup();
    await invoke(IPC.finishWelcome, 'claude-code');
    const scout = companionOn(SCOUT, 'claude-code', getRole('companion')!);
    expect(calls).toEqual([
      ['pets.list', {}],
      ['pets.upsert', { pet: scout }],
      ['experts.list', {}],
      ['experts.upsert', { expert: expect.objectContaining({ id: 'claude-code' }) }],
      ['settings.set', { patch: { welcome: FINISHED } }],
    ]);
    expect(deps.setSettings).toHaveBeenCalledWith({ ...SETTINGS, welcome: FINISHED });
    expect(order).toEqual(['setSettings', 'reloadAvatar', 'welcomed']);
  });
});
