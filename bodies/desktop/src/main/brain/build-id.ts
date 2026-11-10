/**
 * The desktop's own build id, to compare with the one the brain reports in hello.
 * Packaged, the build is the app version (the brain gets it as TAGALONG_BUILD); in a dev
 * checkout it is a hash of the brain's source, the same recipe as brain/src/brain/build_info.py
 * (both are tested against brain/tests/fixtures/build-hash).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Relative posix paths of every .py and .md under root, outside __pycache__. */
function sourceFiles(root: string, dir = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name !== '__pycache__') found.push(...sourceFiles(root, rel));
    } else if (rel.endsWith('.py') || rel.endsWith('.md')) {
      found.push(rel);
    }
  }
  return found;
}

/** First 12 hex chars of sha256 over each file's path, a NUL, its bytes and a NUL, by path. */
export function sourceHash(root: string): string {
  const digest = createHash('sha256');
  // Sort by UTF-8 bytes, as Python sorts its posix path strings by code point.
  const files = sourceFiles(root).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  for (const rel of files) {
    digest.update(Buffer.from(`${rel}\0`));
    digest.update(readFileSync(join(root, rel)));
    digest.update(Buffer.from('\0'));
  }
  return digest.digest('hex').slice(0, 12);
}

export function ownBuild(opts: { packaged: boolean; appVersion: string; brainDir: string }): {
  version: string;
  build: string;
} {
  const build = opts.packaged
    ? opts.appVersion
    : sourceHash(join(opts.brainDir, 'src', 'brain'));
  return { version: opts.appVersion, build };
}
