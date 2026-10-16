/**
 * IPC for Scout as a pet: listing and saving pets, switching Scout's brain, and finishing Welcome.
 * Contains registerCrewIpc.
 */

import { getRole } from '@tagalong/core';
import type { Pet, Settings, SettingsPatch } from '@tagalong/protocol';
import { IPC } from '../../shared/ipc';
import type { FoundAgent } from '../../shared/ipc';
import { companionOn, welcomeCrew, welcomeExperts } from '../welcome';
import type { EngineCall, IpcHandle } from './handle';

export interface CrewIpcDeps {
  /** Throws when the engine is not running. */
  engine: () => EngineCall;
  /** The settings the running app is using. */
  settings: () => Settings;
  setSettings: (settings: Settings) => void;
  /** Redraws the pets on the desktop. */
  refreshStrip: () => void;
  findAgents: () => Promise<FoundAgent[]>;
  /** After Welcome is saved: closes it, and Scout says hello without taking focus. */
  welcomed: () => void;
}

export function registerCrewIpc(handle: IpcHandle, deps: CrewIpcDeps): void {
  const { engine, refreshStrip } = deps;

  handle(IPC.listPets, async (): Promise<Pet[]> => {
    const result = await engine().call('pets.list', {});
    return result.pets;
  });

  handle(IPC.savePet, async (_event, pet: Pet): Promise<Pet> => {
    const saved = (await engine().call('pets.upsert', { pet })).pet;
    refreshStrip();
    return saved;
  });

  // Settings' "no sign-in found": the key is stored first, then Scout moves to that service.
  handle(IPC.switchScout, async (_event, providerId: string): Promise<Pet> => {
    const client = engine();
    const companion = getRole('companion');
    if (companion === undefined) throw new Error('The role library has no Companion.');
    const { pets } = await client.call('pets.list', {});
    const { defaultPetId } = deps.settings();
    const current = pets.find((pet) => pet.id === defaultPetId);
    if (current === undefined) throw new Error(`There is no ${defaultPetId} to switch.`);
    const saved = (
      await client.call('pets.upsert', { pet: companionOn(current, providerId, companion) })
    ).pet;
    refreshStrip();
    return saved;
  });

  // Scout becomes the Companion on the chosen brain and is the only pet shown; any other is
  // hidden, not deleted. Then Welcome closes and Scout says hello in its bubble, without
  // taking focus.
  handle(IPC.finishWelcome, async (_event, providerId: string) => {
    const client = engine();
    const companion = getRole('companion');
    if (companion === undefined) throw new Error('The role library has no Companion.');
    const { pets } = await client.call('pets.list', {});
    const { defaultPetId } = deps.settings();
    const { scout, hiddenPets } = welcomeCrew(pets, defaultPetId, providerId, companion);
    await client.call('pets.upsert', { pet: scout });
    // Claude Code, when it is here, becomes the first expert, so a hand-off works at once.
    const { experts } = await client.call('experts.list', {});
    for (const expert of welcomeExperts(await deps.findAgents(), experts)) {
      await client.call('experts.upsert', { expert });
    }
    // The whole record is kept: a patch replaces `welcome`, and Welcome reads it again.
    const welcome = { ...deps.settings().welcome, done: true, step: 'try' as const };
    const patch: SettingsPatch = { hiddenPets, welcome };
    deps.setSettings((await client.call('settings.set', { patch })).settings);
    refreshStrip();
    deps.welcomed();
  });
}
