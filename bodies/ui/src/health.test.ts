/** Tests for healthRows and healthHeadline. */

import { describe, expect, it } from 'vitest';
import { healthHeadline, healthRows } from './health';
import type { HealthFacts, HealthRow } from './health';

const ALL_GOOD: HealthFacts = {
  key: { hasKey: true },
  connections: [{ name: 'GitHub', status: 'connected' }],
  voice: {
    enabled: true,
    earsUsed: true,
    earsReady: true,
  },
  microphone: { count: 1, pickedMissing: false },
};

const row = (rows: HealthRow[], id: HealthRow['id']): HealthRow => {
  const found = rows.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no ${id} row`);
  return found;
};

describe('healthRows', () => {
  it('gives one row per check, in order, all ok, and says everything works', () => {
    const rows = healthRows(ALL_GOOD);
    expect(rows.map((each) => each.id)).toEqual(['key', 'connections', 'voice', 'microphone']);
    expect(rows.every((each) => each.state === 'ok')).toBe(true);
    expect(rows.every((each) => each.fix === undefined)).toBe(true);
    expect(healthHeadline(rows)).toBe('Everything’s working.');
    expect(rows.map((each) => each.line)).toEqual([
      'Anthropic key is set.',
      'All apps connected.',
      'Ready.',
      'A microphone is ready.',
    ]);
  });

  it('never words a row as Scout speaking', () => {
    const voice = ALL_GOOD.voice as Exclude<HealthFacts['voice'], 'unknown'>;
    const lines = [
      ...healthRows(ALL_GOOD),
      ...healthRows({ ...ALL_GOOD, voice: { ...voice, earsReady: false } }),
    ].map((each) => each.line);
    for (const line of lines) expect(line).not.toMatch(/^I\s|\bI’|\bmy\b/i);
  });

  it('says which connection needs a sign-in or failed', () => {
    const rows = healthRows({
      ...ALL_GOOD,
      connections: [
        { name: 'GitHub', status: 'needs-sign-in' },
        { name: 'Linear', status: 'error' },
        { name: 'Notion', status: 'off' },
      ],
    });
    expect(row(rows, 'connections')).toMatchObject({
      state: 'broken',
      line: 'GitHub needs you to sign in again. Linear isn’t working.',
      fix: 'connections',
    });
    expect(row(healthRows({ ...ALL_GOOD, connections: [] }), 'connections').state).toBe('ok');
  });

  it('says the ears failed to load', () => {
    const voice = { ...(ALL_GOOD.voice as Exclude<HealthFacts['voice'], 'unknown'>) };
    expect(
      row(healthRows({ ...ALL_GOOD, voice: { ...voice, earsReady: false } }), 'voice'),
    ).toMatchObject({
      state: 'broken',
      line: 'The brain could not load its speech models.',
      fix: 'voice',
    });
    // Ears nobody uses are not a problem.
    expect(
      row(
        healthRows({ ...ALL_GOOD, voice: { ...voice, earsUsed: false, earsReady: false } }),
        'voice',
      ).state,
    ).toBe('ok');
    expect(
      row(healthRows({ ...ALL_GOOD, voice: { ...voice, enabled: false } }), 'voice'),
    ).toMatchObject({ state: 'info', line: 'Voice is off.' });
  });

  it('says no microphone was found, or the picked one is unplugged', () => {
    expect(
      row(
        healthRows({ ...ALL_GOOD, microphone: { count: 0, pickedMissing: false } }),
        'microphone',
      ),
    ).toMatchObject({ state: 'broken', line: 'No microphone found.', fix: 'voice' });
    expect(
      row(healthRows({ ...ALL_GOOD, microphone: { count: 2, pickedMissing: true } }), 'microphone'),
    ).toMatchObject({ state: 'broken', line: 'The one you picked is unplugged.', fix: 'voice' });
  });

  it('no key is a broken row with a fix target that opens step 9', () => {
    const rows = healthRows({ ...ALL_GOOD, key: { hasKey: false } });
    expect(row(rows, 'key')).toMatchObject({
      state: 'broken',
      line: 'Add your Anthropic key to start.',
      fix: 'key',
    });
    expect(healthHeadline(rows)).toBe('One thing needs you.');
  });

  it('has key is ok', () => {
    expect(row(healthRows(ALL_GOOD), 'key')).toMatchObject({ state: 'ok' });
  });

  it('unknown key is not counted', () => {
    const rows = healthRows({ ...ALL_GOOD, key: 'unknown' });
    expect(row(rows, 'key')).toMatchObject({ state: 'unknown', line: 'Not checked.' });
    expect(healthHeadline(rows)).toBe('Everything’s working.');
  });

  it('has_no_browser_extension_row', () => {
    const ids: string[] = healthRows(ALL_GOOD).map((each) => each.id);
    expect(ids).not.toContain('extension');
  });

  it('turns a fact it could not read into an unknown row, not a problem', () => {
    const rows = healthRows({
      key: 'unknown',
      connections: 'unknown',
      voice: 'unknown',
      microphone: 'unknown',
    });
    expect(rows.every((each) => each.state === 'unknown')).toBe(true);
    expect(rows.every((each) => each.fix === undefined)).toBe(true);
    expect(row(rows, 'connections').line).toBe('Not checked.');
  });

  it('counts what needs the person in the headline', () => {
    const voice = ALL_GOOD.voice as Exclude<HealthFacts['voice'], 'unknown'>;
    const rows = healthRows({
      ...ALL_GOOD,
      voice: { ...voice, earsReady: false },
      connections: [{ name: 'GitHub', status: 'error' }],
    });
    expect(healthHeadline(rows)).toBe('Two things need you.');
    expect(
      healthHeadline(healthRows({ ...ALL_GOOD, microphone: { count: 0, pickedMissing: false } })),
    ).toBe('One thing needs you.');
  });
});
