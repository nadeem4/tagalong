/** Tests for the desktop's own build id: it must agree with the brain's hash of the same files. */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ownBuild, sourceHash } from './build-id';

// The same fixture and literal as brain/tests/test_build_info.py.
const FIXTURE = fileURLToPath(
  new URL('../../../../../brain/tests/fixtures/build-hash', import.meta.url),
);
const FIXTURE_HASH = '944069bbc26e';

describe('sourceHash', () => {
  it("matches the brain's hash for the shared fixture", () => {
    expect(sourceHash(FIXTURE)).toBe(FIXTURE_HASH);
  });
});

describe('ownBuild', () => {
  it('packaged build is the app version', () => {
    expect(ownBuild({ packaged: true, appVersion: '0.9.2', brainDir: FIXTURE })).toEqual({
      version: '0.9.2',
      build: '0.9.2',
    });
  });

  it('in dev the build is a hash of the brain source', () => {
    // brainDir/src/brain is hashed, so point brainDir at a folder whose src/brain is the fixture.
    const root = fileURLToPath(new URL('../../../../../brain', import.meta.url));
    const own = ownBuild({ packaged: false, appVersion: '0.9.2', brainDir: root });
    expect(own.version).toBe('0.9.2');
    expect(own.build).toBe(sourceHash(`${root}/src/brain`));
    expect(own.build).toMatch(/^[0-9a-f]{12}$/);
  });
});
