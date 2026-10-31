/**
 * Source guard for the shared UI: the shapes folder stays React-free so desktop main and the
 * brain can import it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = import.meta.dirname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('source guards', () => {
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
