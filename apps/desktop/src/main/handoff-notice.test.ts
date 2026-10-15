import { describe, expect, it } from 'vitest';
import { handoffNotice } from './handoff-notice';

const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('handoffNotice', () => {
  it('says the expert finished, with the start of its answer', () => {
    expect(
      handoffNotice({ handoffId: id, expertId: 'claude-code', state: 'done', text: 'Fixed it.' }),
    ).toEqual({ title: 'claude-code finished', body: 'Fixed it. Open Home to read it all.' });
  });

  it('names the files it changed', () => {
    expect(
      handoffNotice({
        handoffId: id,
        expertId: 'claude-code',
        state: 'done',
        text: 'Fixed.',
        changedFiles: ['a.ts', 'b.ts'],
      })?.body,
    ).toBe('Fixed. Changed a.ts, b.ts. Open Home to read it all.');
  });

  it('cuts a long answer short', () => {
    const body = handoffNotice({
      handoffId: id,
      expertId: 'x',
      state: 'done',
      text: 'word '.repeat(100),
    })?.body;
    expect(body?.length).toBeLessThan(220);
    expect(body).toContain('…');
  });

  it('says why a hand-off failed', () => {
    expect(
      handoffNotice({ handoffId: id, expertId: 'x', state: 'error', error: 'not signed in' }),
    ).toEqual({ title: 'x could not finish', body: 'not signed in' });
  });

  it('stays quiet for a step that hands on: the chain’s last step tells', () => {
    expect(
      handoffNotice({
        handoffId: id,
        expertId: 'coder',
        state: 'done',
        text: 'Fixed.',
        next: { handoffId: id, expertId: 'reviewer', expertName: 'Reviewer' },
      }),
    ).toBeNull();
  });

  it('stays quiet for a hand-off the user stopped', () => {
    expect(handoffNotice({ handoffId: id, expertId: 'x', state: 'stopped' })).toBeNull();
  });
});
