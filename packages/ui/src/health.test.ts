import { describe, expect, it } from 'vitest';
import { healthHeadline, healthRows } from './health';
import type { HealthFacts, HealthRow } from './health';

const ALL_GOOD: HealthFacts = {
  brain: 'ready',
  experts: [{ name: 'Coder', ok: true }],
  connections: [{ name: 'GitHub', status: 'connected' }],
  voice: {
    enabled: true,
    mouth: 'kokoro',
    elevenLabsKey: false,
    mouthReady: true,
    earsUsed: true,
    earsReady: true,
  },
  microphone: { count: 1, pickedMissing: false },
  extension: true,
};

const row = (rows: HealthRow[], id: HealthRow['id']): HealthRow => {
  const found = rows.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no ${id} row`);
  return found;
};

describe('healthRows', () => {
  it('gives one row per check, in order, all ok, and says everything works', () => {
    const rows = healthRows(ALL_GOOD);
    expect(rows.map((each) => each.id)).toEqual([
      'brain',
      'experts',
      'connections',
      'voice',
      'microphone',
      'extension',
    ]);
    expect(rows.every((each) => each.state === 'ok')).toBe(true);
    expect(rows.every((each) => each.fix === undefined)).toBe(true);
    expect(healthHeadline(rows)).toBe('Everything’s working.');
  });

  it.each([
    ['signed-out', 'I’m signed out of Claude.'],
    ['no-sign-in', 'I can’t find Claude Code on this computer.'],
    ['no-key', 'I have no API key.'],
  ] as const)('a %s brain is broken and fixed under How Scout thinks', (brain, line) => {
    expect(row(healthRows({ ...ALL_GOOD, brain }), 'brain')).toMatchObject({
      state: 'broken',
      line,
      fix: 'brain',
    });
  });

  it('names an expert that cannot be reached, and says when none are on', () => {
    const unreachable = healthRows({
      ...ALL_GOOD,
      experts: [
        { name: 'Coder', ok: false },
        { name: 'Writer', ok: true },
      ],
    });
    expect(row(unreachable, 'experts')).toMatchObject({
      state: 'broken',
      line: 'Coder can’t be reached.',
      fix: 'experts',
    });
    const two = healthRows({
      ...ALL_GOOD,
      experts: [
        { name: 'Coder', ok: false },
        { name: 'Writer', ok: false },
      ],
    });
    expect(row(two, 'experts').line).toBe('Coder and Writer can’t be reached.');
    expect(row(healthRows({ ...ALL_GOOD, experts: [] }), 'experts')).toMatchObject({
      state: 'broken',
      line: 'No experts are on.',
      fix: 'experts',
    });
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

  it('says the ElevenLabs voice has no key, and the ears are not downloaded', () => {
    const voice = { ...(ALL_GOOD.voice as Exclude<HealthFacts['voice'], 'unknown'>) };
    expect(
      row(healthRows({ ...ALL_GOOD, voice: { ...voice, mouth: 'elevenlabs' } }), 'voice'),
    ).toMatchObject({ state: 'broken', line: 'The ElevenLabs voice has no key.', fix: 'voice' });
    expect(
      row(healthRows({ ...ALL_GOOD, voice: { ...voice, earsReady: false } }), 'voice'),
    ).toMatchObject({ state: 'broken', line: 'My ears’ model isn’t downloaded.', fix: 'voice' });
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

  it('shows a missing extension as info, never counted', () => {
    const rows = healthRows({ ...ALL_GOOD, extension: false });
    expect(row(rows, 'extension')).toMatchObject({
      state: 'info',
      line: 'Not connected (optional)',
      fix: 'browser',
    });
    expect(healthHeadline(rows)).toBe('Everything’s working.');
  });

  it('turns a fact it could not read into an unknown row, not a problem', () => {
    const rows = healthRows({
      brain: 'unknown',
      experts: 'unknown',
      connections: 'unknown',
      voice: 'unknown',
      microphone: 'unknown',
      extension: 'unknown',
    });
    expect(rows.every((each) => each.state === 'unknown')).toBe(true);
    expect(rows.every((each) => each.fix === undefined)).toBe(true);
    expect(row(rows, 'experts').line).toBe('I couldn’t check this.');
  });

  it('counts what needs the person in the headline', () => {
    const rows = healthRows({ ...ALL_GOOD, brain: 'signed-out', experts: [] });
    expect(healthHeadline(rows)).toBe('Two things need you.');
    expect(healthHeadline(healthRows({ ...ALL_GOOD, brain: 'no-key' }))).toBe(
      'One thing needs you.',
    );
  });
});
