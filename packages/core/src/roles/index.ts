/**
 * The role and soul libraries, the constitution and their helpers. Contains `getRole`,
 * `roleFor` (falls back to the companion), `CONSTITUTION` (the values and the Never list
 * every mind's prompt starts with), `ACTIVE_SOUL`, `soul()` (the character that follows it),
 * `modeSystem` (the constitution, the soul and a mode's block, for the minds that are not a
 * turn) and `recommendedModel` (a role's tier mapped to a model on one provider).
 * Used by the prompt assembler, the tool registry, the key check, the engine and the
 * desktop's Welcome.
 */
import type { Role } from '@tagalong/protocol';
import { CONSTITUTION, ROLE_LIBRARY, SOUL_LIBRARY } from './library.generated';
import { MODEL_TIERS } from './tiers';

/** The values in their order and the Never list, from constitution.md. Read-only to the mind. */
export { CONSTITUTION };

/**
 * The soul Scout speaks with: who Scout is, apart from its values and what it can do. To re-character
 * Scout, edit soul/scout.md; for a second character, add soul/<id>.md and change this.
 */
export const ACTIVE_SOUL = 'scout';

/** The active soul's text: its Character, as written in its file. */
export function soul(): string {
  const text = SOUL_LIBRARY[ACTIVE_SOUL];
  if (text === undefined) throw new Error(`the soul library has no "${ACTIVE_SOUL}"`);
  return text;
}

/**
 * The system prompt for every mind that is not a turn but speaks or judges as Scout (checking
 * in, sleeping, tidying memory, summarising): the constitution first, then the same soul a
 * turn has, then the mode's own block. One identity and one set of values in every mode. A
 * watch's yes/no check is plumbing and gets neither the constitution nor the soul.
 */
export function modeSystem(block: string): string {
  return `${CONSTITUTION}\n\n${soul()}\n\n${block}`;
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
