/**
 * Small rules shared by the connection code: whether an MCP tool reads or writes (accessOf),
 * how much asking a write needs (riskOf), and how Claude Code style ${VAR} references are expanded (expandEnv) and recognised
 * (isEnvReference).
 */
import type { AskRisk, ToolAccess } from '@tagalong/protocol';

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

/** Words in a tool's name that mean the change cannot be taken back. */
const HIGH_RISK_WORDS: ReadonlySet<string> = new Set([
  'send',
  'delete',
  'remove',
  'destroy',
  'trash',
  'pay',
  'charge',
  'purchase',
  'transfer',
  'push',
  'merge',
  'publish',
  'post',
  'share',
  'invite',
]);

/**
 * How much asking a tool needs: `read` asks nothing (accessOf says read), `high` is a write
 * that cannot be undone (the app says destructive, or a word in its name says so, split on
 * `_`, `-` and camelCase), and every other write, unknown tools included, is `change`.
 * Code guardrails, not the model's judgement. A miss still asks; an over-flag only adds a label.
 */
export function riskOf(hints: AccessHints | undefined, name: string): AskRisk {
  if (accessOf(hints) === 'read') return 'read';
  if (hints?.destructiveHint === true) return 'high';
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_\-.]+/);
  return words.some((word) => HIGH_RISK_WORDS.has(word)) ? 'high' : 'change';
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
