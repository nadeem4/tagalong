/**
 * The role and soul libraries and their helpers. Contains `getRole`, `roleFor` (falls back
 * to the companion), `ACTIVE_SOUL`, `identity` (the constitution and soul every prompt starts
 * with, named), `modeSystem` (the identity plus a mode's block, for every mind that is not a
 * turn) and
 * `recommendedModel` (a role's tier mapped to a model on one provider).
 * Used by the prompt assembler, the tool registry, the key check, the engine and the
 * desktop's Welcome.
 */
import type { Role } from '@tagalong/protocol';
import { CONSTITUTION, ROLE_LIBRARY, SOUL_LIBRARY } from './library.generated';
import { MODEL_TIERS } from './tiers';

/**
 * The soul the companion speaks with: who it is and how it talks, apart from what it can do. To
 * re-character it, edit soul/scout.md; for a second character, add soul/<id>.md and change this.
 */
export const ACTIVE_SOUL = 'scout';

/** Where the companion's name goes in the constitution and the soul. */
const NAME_SLOT = '{name}';

/**
 * Who the companion is, the start of every prompt: the constitution (its values, which wins when
 * they conflict, and its Never list), then the active soul (its character and way of speaking),
 * with its name filled in. The name is the pet's, so it is set in one place.
 */
export function identity(name: string): string {
  const soul = SOUL_LIBRARY[ACTIVE_SOUL];
  if (soul === undefined) throw new Error(`the soul library has no "${ACTIVE_SOUL}"`);
  return `${CONSTITUTION}\n\n${soul}`.replaceAll(NAME_SLOT, name.trim());
}

/**
 * The system prompt for every mind that is not a turn but speaks or judges as {name} (checking
 * in, tidying memory, summarising, sleeping): the same identity a turn starts with, then the
 * mode's own block. One identity in every mode. A watch's yes/no check is plumbing and gets none.
 */
export function modeSystem(block: string, name: string): string {
  return `${identity(name)}\n\n${block}`;
}

/** The role with this id, or undefined when there is none. */
export function getRole(id: string): Role | undefined {
  return ROLE_LIBRARY.find((role) => role.id === id);
}

/** The role every pet falls back to when its own is missing from the library. */
const FALLBACK_ROLE_ID = 'companion';

/**
 * The role a pet with this role id works as: its own, or the companion when the library
 * has no such role (a role id an older saved pet still names, or a hand-edited database).
 */
export function roleFor(roleId: string): Role {
  const role = getRole(roleId) ?? getRole(FALLBACK_ROLE_ID);
  if (role === undefined) throw new Error(`the role library has no "${FALLBACK_ROLE_ID}"`);
  return role;
}

export interface RecommendedModel {
  model: string;
}

/**
 * The model a new pet with this role starts on, for its provider, or undefined when the
 * provider has no tier table.
 */
export function recommendedModel(role: Role, providerId: string): RecommendedModel | undefined {
  const tiers = Object.hasOwn(MODEL_TIERS, providerId) ? MODEL_TIERS[providerId] : undefined;
  if (tiers === undefined) return undefined;
  return { model: tiers[role.model.tier] };
}
