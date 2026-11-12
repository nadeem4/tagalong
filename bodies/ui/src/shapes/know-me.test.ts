/** Tests for the get-to-know-me shapes: the sources Home lists, the run input and the status frame. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KnowMeInput, KnowMeStatus, KnowSourceInfo } from './know-me';

const frame = (name: string): { params: unknown } =>
  JSON.parse(
    // From this file, not the working directory: CI runs from a different folder.
    readFileSync(resolve(__dirname, '../../../../protocol/examples/valid', name), 'utf8'),
  ) as { params: unknown };

describe('KnowMeStatus', () => {
  it('parses the contract frame example', () => {
    const status = KnowMeStatus.parse(frame('brain.know_me_status.params.json').params);
    expect(status.sources.map((s) => s.state)).toEqual(['done', 'reading', 'waiting']);
    expect(status.done).toBe(false);
  });

  it('parses the finished frame, with a portrait and a gap', () => {
    const status = KnowMeStatus.parse({
      sources: [{ name: 'GitHub', state: 'failed', gap: 'No such user.' }],
      done: true,
      portrait: 'You build things.',
    });
    expect(status.sources[0]?.gap).toBe('No such user.');
    expect(status.portrait).toBe('You build things.');
  });

  it('refuses a state the brain never sends', () => {
    expect(
      KnowMeStatus.safeParse({ sources: [{ name: 'GitHub', state: 'paused' }], done: false })
        .success,
    ).toBe(false);
  });
});

describe('KnowSourceInfo and KnowMeInput', () => {
  it('knows the three things a source can need', () => {
    expect(KnowSourceInfo.shape.needs.options).toEqual(['username', 'file', 'none']);
  });

  it('takes a username, a pdf, or both', () => {
    expect(KnowMeInput.parse({ github: 'octo' })).toEqual({ github: 'octo' });
    expect(KnowMeInput.parse({ pdf: { name: 'cv.pdf', data: 'AAAA' } }).pdf?.name).toBe('cv.pdf');
  });
});
