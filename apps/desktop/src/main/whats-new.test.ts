/** Tests for the What's new line and the version bump that makes a launch say it once. */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Settings, type SettingsPatch } from '@tagalong/protocol';
import { recordLaunch } from './launch';
import { WHATS_NEW } from './whats-new';

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
 * One launch, as greetOnLaunch sees it: core's launchScenario calls it an update (and says
 * What's new) only when the recorded last version differs from this one.
 */
function isUpdate(s: ReturnType<typeof store>): boolean {
  const previous = recordLaunch(s, version);
  return previous.lastVersion !== null && previous.lastVersion !== version;
}

describe('WHATS_NEW', () => {
  it('names what this release added, in two short spoken sentences', () => {
    expect(WHATS_NEW).toBe(
      'I can write short drafts, translate, read things aloud and point at buttons now. Ask me “what needs me?” to see your reviews and issues in one list.',
    );
    expect(WHATS_NEW.length).toBeLessThan(200);
    expect(WHATS_NEW).not.toContain('—');
  });
});

describe('the version What’s new rides on', () => {
  it('has moved past 0.0.0, which every existing install recorded', () => {
    expect(version).toBe('0.1.0');
  });

  it('plays once for someone updating from 0.0.0, then not on the next launch', () => {
    const s = store({ closedCleanly: true, lastVersion: '0.0.0' });
    expect(isUpdate(s)).toBe(true);
    s.set({ closedCleanly: true });
    expect(isUpdate(s)).toBe(false);
  });

  it('never plays on a first install: there is no last version', () => {
    expect(isUpdate(store({ closedCleanly: true }))).toBe(false);
  });
});
