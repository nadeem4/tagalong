/** Tests for the finished hand-off notification. */

import { describe, expect, it } from 'vitest';
import { bubbleHearsRemark, handoffLine, handoffNotice } from './handoff-notice';

const id = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('handoffNotice', () => {
  it('says the expert finished, with the start of its answer', () => {
    expect(
      handoffNotice({ handoffId: id, expertId: 'claude-code', state: 'done', text: 'Fixed it.' }),
    ).toEqual({ title: 'claude-code finished', body: 'Fixed it. Open Home to read it all.' });
  });

  it('names the expert by its name when known', () => {
    expect(
      handoffNotice(
        { handoffId: id, expertId: 'claude-code', state: 'done', text: 'Fixed it.' },
        'Claude Code',
      )?.title,
    ).toBe('Claude Code finished');
    expect(
      handoffNotice({ handoffId: id, expertId: 'x', state: 'error', error: 'gone' }, 'Coder')
        ?.title,
    ).toBe('Coder could not finish');
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

describe('handoffLine', () => {
  const remarkId = '7c9e6679-7425-40de-944b-e07fc1f90ae8';
  const line = { remarkId, petId: 'scout', text: 'All green now.', handoffId: id };

  it('goes to the hand-off card while the bubble is open', () => {
    expect(handoffLine(line, true)).toEqual(line);
  });

  it('becomes an ordinary line once the bubble is closed, so it is not lost', () => {
    expect(handoffLine(line, false)).toEqual({ remarkId, petId: 'scout', text: 'All green now.' });
  });

  it('leaves a line that is not about a hand-off alone', () => {
    const plain = { remarkId, petId: 'scout', text: 'Hi.' };
    expect(handoffLine(plain, false)).toEqual(plain);
    expect(handoffLine(plain, true)).toEqual(plain);
  });
});

describe('bubbleHearsRemark', () => {
  const plain = { remarkId: id, petId: 'scout', text: 'Hi.' };

  it('panel hidden when the remark arrives: the panel’s bubble is skipped', () => {
    // The caller passes the visibility from before showRemark brings the panel up.
    expect(bubbleHearsRemark(plain, false)).toBe(false);
  });

  it('panel visible when the remark arrives: it goes to the bubble', () => {
    expect(bubbleHearsRemark(plain, true)).toBe(true);
  });

  it('lets the open bubble show a plain remark, since no quiet line appears then', () => {
    expect(bubbleHearsRemark(plain, true)).toBe(true);
  });

  it('keeps a plain remark from a closed panel’s bubble: the quiet line shows it', () => {
    expect(bubbleHearsRemark(plain, false)).toBe(false);
  });

  it('always lets a line about a hand-off through to its card', () => {
    expect(bubbleHearsRemark({ ...plain, handoffId: id }, true)).toBe(true);
    expect(bubbleHearsRemark({ ...plain, handoffId: id }, false)).toBe(true);
  });
});
