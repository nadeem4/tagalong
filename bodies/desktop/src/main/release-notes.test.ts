/** Tests for the release notes and the version bump that makes a launch send them once. */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Settings, type SettingsPatch } from '@tagalong/protocol';
import { recordLaunch } from './launch';
import { RELEASE_NOTES } from './release-notes';

const version = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

function store(initial: Record<string, unknown>) {
  let current = Settings.parse(initial);
  return {
    get: vi.fn(() => current),
    set: vi.fn((patch: SettingsPatch) => (current = Settings.parse({ ...current, ...patch }))),
  };
}

/**
 * One launch, as greetOnLaunch sees it: the check-in calls it an update (and sends the
 * release notes) only when the recorded last version differs from this one.
 */
function isUpdate(s: ReturnType<typeof store>): boolean {
  const previous = recordLaunch(s, version);
  return previous.lastVersion !== null && previous.lastVersion !== version;
}

describe('RELEASE_NOTES', () => {
  it('names this version and what it added, as facts the mind may mention', () => {
    expect(RELEASE_NOTES.startsWith(`New in ${version}: `)).toBe(true);
    expect(RELEASE_NOTES).toContain('translation');
    expect(RELEASE_NOTES.length).toBeLessThan(200);
  });

  it('is not a line in Scout’s voice: no first person, no em dash', () => {
    expect(RELEASE_NOTES).not.toMatch(/\bI\b|\bI’|\bI'|\bmy\b/);
    expect(RELEASE_NOTES).not.toContain('—');
  });
});

describe('the version the release notes ride on', () => {
  it('has moved past 0.0.0, which every existing install recorded', () => {
    expect(version).toBe('0.1.0');
  });

  it('is an update once for someone updating from 0.0.0, then not on the next launch', () => {
    const s = store({ closedCleanly: true, lastVersion: '0.0.0' });
    expect(isUpdate(s)).toBe(true);
    s.set({ closedCleanly: true });
    expect(isUpdate(s)).toBe(false);
  });

  it('is never an update on a first install: there is no last version', () => {
    expect(isUpdate(store({ closedCleanly: true }))).toBe(false);
  });
});
