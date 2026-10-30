/**
 * Source guard: the old TypeScript brain is gone, so nothing
 * in the repo may name it again. A grep-style walk catches config, docs and
 * skills that unit tests cannot see. docs/superpowers dated plans are history.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out']);
const SKIP_PREFIXES = ['docs/superpowers'];
const ROOTS = [
  'bodies',
  'protocol',
  '.github',
  '.claude/skills',
  'docs',
  'eslint.config.js',
  'vitest.config.ts',
  'pnpm-workspace.yaml',
  'package.json',
  '.prettierignore',
  'CLAUDE.md',
  'README.md',
];
const ROOT_PATTERNS = [/^tsconfig.*\.json$/];

const posix = (p: string): string => relative(ROOT, p).split('\\').join('/');

function walk(path: string): string[] {
  const rel = posix(path);
  if (SKIP_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`))) return [];
  if (!statSync(path).isDirectory()) return [path];
  if (SKIP_DIRS.has(path.split(/[\\/]/).pop() ?? '')) return [];
  return readdirSync(path).flatMap((name) => walk(join(path, name)));
}

const files = (): string[] => {
  const top = readdirSync(ROOT).filter((n) => ROOT_PATTERNS.some((r) => r.test(n)));
  // A listed root that cannot be read throws, so the guard never goes quiet over a typo.
  return [...ROOTS, ...top].flatMap((r) => walk(join(ROOT, r)));
};
const THIS_FILE = fileURLToPath(import.meta.url);

// Built from pieces so this file does not name the packages it forbids.
const REMOVED_CORE = new RegExp(['@tagalong/' + 'core', 'packages/' + 'core'].join('|'));
const REMOVED_PROTOCOL = new RegExp(
  ['@tagalong/' + 'protocol', 'packages/' + 'protocol'].join('|'),
);

const namers = (re: RegExp): string[] =>
  files()
    .filter((f) => /\.(m?[jt]sx?|json|ya?ml|md|toml)$|\.prettierignore$/.test(f))
    .filter((f) => f !== THIS_FILE && re.test(readFileSync(f, 'utf8')))
    .map(posix);

describe('source guard', () => {
  it('fails_when_a_listed_root_is_missing', () => {
    expect(() => walk(join(ROOT, 'no-such-root-for-the-guard'))).toThrow();
  });

  it('every_listed_root_exists', () => {
    expect(() => files()).not.toThrow();
  });

  it('nothing_names_the_removed_core_package', () => {
    expect(namers(REMOVED_CORE)).toEqual([]);
  });

  it('nothing_names_the_removed_protocol_package', () => {
    expect(namers(REMOVED_PROTOCOL)).toEqual([]);
  });
});
