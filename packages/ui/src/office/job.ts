import type { Role } from '@tagalong/protocol';
import { officeTokens } from './tokens';

/** The small caps line under a pet's name in the party list, and its colour. */
export interface Job {
  readonly label: string;
  readonly ink: string;
}

const GENERALIST: Job = { label: 'GENERALIST', ink: officeTokens.roleInk.generalist };

/**
 * A pet's job as the office shows it: its role's name in capitals, in that class's ink. A
 * role the library does not have works as a generalist, the same fallback the engine uses.
 */
export function jobFor(roleId: string, roles: readonly Role[]): Job {
  const role = roles.find((r) => r.id === roleId);
  if (role === undefined) return GENERALIST;
  const inks: Readonly<Record<string, string>> = officeTokens.roleInk;
  const ink = Object.hasOwn(inks, role.id) ? inks[role.id] : undefined;
  return { label: role.name.toUpperCase(), ink: ink ?? officeTokens.color.textMuted };
}
