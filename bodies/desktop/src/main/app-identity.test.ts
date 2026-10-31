/** Tests that the app keeps its name, so its user data folder never moves. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Electron derives `app.getName()` from `productName` in the app's package.json, falling
 * back to `name`. `app.getPath('userData')` is then %APPDATA%\<that name>, which is where
 * settings, the SQLite database and the voice models live.
 *
 * Our `name` is the scoped workspace id `@tagalong/desktop`. Electron strips the characters
 * a directory cannot hold, so without `productName` every user's data lands in
 * `%APPDATA%\@tagalongdesktop`. Changing it after a release strands that data with no
 * migration path, so it is pinned here rather than left to whoever edits package.json next.
 */
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { name: string; productName?: string };

describe('desktop app identity', () => {
  it('declares productName, so user data does not land in a scoped-package directory', () => {
    expect(manifest.productName).toBe('Tagalong');
  });

  it('keeps a productName that is usable as a directory name', () => {
    // The characters Windows forbids in a path segment, plus the separators. If
    // productName ever grows one of these, Electron silently strips it and the data
    // directory moves — the same stranding this test exists to prevent.
    expect(manifest.productName).toMatch(/^[^<>:"/\\|?*]+$/);
    expect(manifest.productName?.trim()).toBe(manifest.productName);
  });

  it('still uses the scoped workspace id as the package name', () => {
    // Guards the other direction: renaming the workspace package to fix the data path
    // would break every `workspace:*` reference instead.
    expect(manifest.name).toBe('@tagalong/desktop');
  });
});
