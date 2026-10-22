/**
 * Types for gen-roles.mjs, so library.test.ts can import it.
 */
import type { Role } from '@tagalong/protocol';

export const ROLES_DIR: string;
export const SOULS_DIR: string;
export const CONSTITUTION_FILE: string;
export const LIBRARY_FILE: string;
export const SOUL_HEADINGS: readonly string[];
export const CONSTITUTION_HEADINGS: readonly string[];
export const NAME_SLOT: string;
export function parseRoleFile(source: string): unknown;
export function loadRoles(dir?: string): Role[];
export function parseSoulFile(source: string): string;
export function parseConstitutionFile(source: string): string;
export function loadSouls(dir?: string): Record<string, string>;
export function loadConstitution(file?: string): string;
export function renderLibrary(
  roles: readonly Role[],
  souls: Readonly<Record<string, string>>,
  constitution: string,
): string;
