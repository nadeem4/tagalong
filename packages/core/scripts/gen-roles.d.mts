import type { Role } from '@tagalong/protocol';

export const ROLES_DIR: string;
export const LIBRARY_FILE: string;
export function parseRoleFile(source: string): unknown;
export function loadRoles(dir?: string): Role[];
export function renderLibrary(roles: readonly Role[]): string;
