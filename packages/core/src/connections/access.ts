import type { ToolAccess } from '@tagalong/protocol';

/** The MCP tool annotations the classification reads. Both are hints from the server. */
export interface AccessHints {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
}

/**
 * Read or write. Only a tool the server marks read-only, and not destructive, is read:
 * unknown counts as write, so a tool that says nothing about itself is always asked about.
 */
export function accessOf(hints: AccessHints | undefined): ToolAccess {
  return hints?.readOnlyHint === true && hints.destructiveHint !== true ? 'read' : 'write';
}

/** `${VAR}` and `${VAR:-default}`, as Claude Code writes them. An unset VAR is empty. */
export function expandEnv(value: string, env: Record<string, string | undefined>): string {
  return value.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g,
    (_m, name: string, fallback?: string) => {
      const set = env[name];
      return set !== undefined && set !== '' ? set : (fallback ?? '');
    },
  );
}

/** True for a whole value that is only a `${VAR}` reference: safe to copy, it holds no secret. */
export function isEnvReference(value: string): boolean {
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}$/.test(value);
}
