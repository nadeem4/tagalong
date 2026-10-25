/**
 * IPC for Scout as a pet: listing and saving it, switching Scout's brain, and finishing Welcome.
 * Contains registerScoutIpc.
 */

import { getRole } from '@tagalong/core';
import { SCOUT_ID } from '@tagalong/protocol';
import type { Pet, Settings, SettingsPatch } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { FoundAgent } from '../../shared/ipc';
import { companionOn, welcomeExperts } from '../welcome';
import type { EngineCall, IpcHandle } from './handle';

export interface ScoutIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
  /** The settings the running app is using. */
  settings: () => Settings;
  setSettings: (settings: Settings) => void;
  /** Reloads Scout's window after Scout's record changed. */
  reloadAvatar: () => void;
  findAgents: () => Promise<FoundAgent[]>;
  /** After Welcome is saved: closes it, and Scout says hello without taking focus. */
  welcomed: () => void;
}

export function registerScoutIpc(handle: IpcHandle, deps: ScoutIpcDeps): void {
  const { engine, reloadAvatar } = deps;

  handle(IPC.listPets, async (): Promise<Pet[]> => {
    const result = await engine().call('pets.list', {});
    return result.pets;
  });

  handle(IPC.savePet, async (_event, pet: Pet): Promise<Pet> => {
    const saved = (await engine().call('pets.upsert', { pet })).pet;
    reloadAvatar();
    return saved;
  });

  // Settings' "no sign-in found": the key is stored first, then Scout moves to that service.
  handle(IPC.switchScout, async (_event, providerId: string): Promise<Pet> => {
    const client = engine();
    const companion = getRole('companion');
    if (companion === undefined) throw new Error('The role library has no Companion.');
    const { pets } = await client.call('pets.list', {});
    const current = pets.find((pet) => pet.id === SCOUT_ID);
    if (current === undefined) throw new Error('There is no Scout to switch.');
    const saved = (
      await client.call('pets.upsert', { pet: companionOn(current, providerId, companion) })
    ).pet;
    reloadAvatar();
    return saved;
  });

  // Scout becomes the Companion on the chosen brain. Then Welcome closes and Scout says hello
  // in its bubble, without taking focus.
  handle(IPC.finishWelcome, async (_event, providerId: string) => {
    const client = engine();
    const companion = getRole('companion');
    if (companion === undefined) throw new Error('The role library has no Companion.');
    const { pets } = await client.call('pets.list', {});
    const current = pets.find((pet) => pet.id === SCOUT_ID);
    if (current === undefined) throw new Error('There is no Scout to welcome.');
    await client.call('pets.upsert', { pet: companionOn(current, providerId, companion) });
    // Claude Code, when it is here, becomes the first expert, so a hand-off works at once.
    const { experts } = await client.call('experts.list', {});
    for (const expert of welcomeExperts(await deps.findAgents(), experts)) {
      await client.call('experts.upsert', { expert });
    }
    // The whole record is kept: a patch replaces `welcome`, and Welcome reads it again.
    const welcome = { ...deps.settings().welcome, done: true, step: 'try' as const };
    const patch: SettingsPatch = { welcome };
    deps.setSettings((await client.call('settings.set', { patch })).settings);
    reloadAvatar();
    deps.welcomed();
  });
}
