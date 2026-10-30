/**
 * Source guards for the shared UI: it no longer reads the old wire-types package, and the
 * shapes folder stays React-free so desktop main and the voice process can import it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;
const THIS_FILE = join(SRC, 'source-guard.test.ts');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

// Built from pieces so this file does not name the package it forbids.
const REMOVED = new RegExp('@tagalong/' + 'protocol');

describe('source guards', () => {
  it('imports_no_removed_protocol_package', () => {
    const hits = sources(SRC).filter(
      (p) => p !== THIS_FILE && REMOVED.test(readFileSync(p, 'utf8')),
    );
    expect(hits).toEqual([]);
  });

  it('shapes_import_no_react_and_no_tsx', () => {
    const shapes = join(SRC, 'shapes');
    const all = sources(shapes);
    expect(all.length).toBeGreaterThan(0);
    for (const path of all) {
      expect(path, path).not.toMatch(/\.tsx$/);
      // Nothing above shapes/ is imported, so no component or hook can sneak React in.
      expect(readFileSync(path, 'utf8'), path).not.toMatch(
        /from '(react|react-dom)(\/[^']*)?'|from '\.\.\//,
      );
    }
  });
});
