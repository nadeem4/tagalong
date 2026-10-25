/**
 * Tests for Welcome's step machine: start and resume, answers, chips, what is saved, when it
 * listens.
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, Settings, WELCOME_STEPS } from '@tagalong/protocol';
import {
  answerPatch,
  answered,
  chipState,
  goTo,
  listensNow,
  oneAtATime,
  startFirstRun,
} from './first-run';

const fresh = Settings.parse({});

describe('startFirstRun', () => {
  it('starts a new install at How to answer, the first step', () => {
    expect(startFirstRun(fresh)).toEqual({
      steps: WELCOME_STEPS,
      current: 'answer',
      reached: 'answer',
    });
  });

  it('resumes at the step reached last time', () => {
    const saved = Settings.parse({ welcome: { done: false, step: 'voice' } });
    expect(startFirstRun(saved)).toMatchObject({ current: 'voice', reached: 'voice' });
  });

  it('starts again at the top when a finished setup is opened again', () => {
    const done = Settings.parse({ welcome: { done: true, step: 'try' } });
    expect(startFirstRun(done)).toMatchObject({ current: 'answer', reached: 'answer' });
  });

  it('never asks the name again once it was declined', () => {
    const declined = Settings.parse({
      welcome: { done: true, step: 'try' },
      userNameDeclined: true,
    });
    const run = startFirstRun(declined);
    expect(run).toMatchObject({ current: 'answer', reached: 'answer' });
    expect(answered(run, true)).toMatchObject({ current: 'think', reached: 'think' });
  });

  it('skips the name when setup resumes there after it was declined', () => {
    const saved = Settings.parse({
      welcome: { done: false, step: 'name' },
      userNameDeclined: true,
    });
    expect(startFirstRun(saved)).toMatchObject({ current: 'think', reached: 'think' });
  });
});

describe('answered', () => {
  const run = startFirstRun(fresh);

  it('moves on to the next step by itself', () => {
    expect(answered(run, false)).toMatchObject({ current: 'name', reached: 'name' });
  });

  it('after going back with a chip, returns to the furthest step reached', () => {
    const atVoice = answered(answered(answered(run, false), false), false);
    expect(atVoice.current).toBe('voice');
    const back = goTo(atVoice, 'name');
    expect(back.current).toBe('name');
    expect(answered(back, false)).toMatchObject({ current: 'voice', reached: 'voice' });
  });

  it('after How to answer, a declined name is skipped', () => {
    const declined = Settings.parse({ userNameDeclined: true });
    expect(answered(startFirstRun(declined), true).current).toBe('think');
  });

  it('ends on Try it and stays there', () => {
    let at = run;
    for (let i = 0; i < 5; i += 1) at = answered(at, false);
    expect(at.current).toBe('try');
    expect(answered(at, false).current).toBe('try');
  });
});

describe('goTo and chipState', () => {
  it('opens only steps already reached', () => {
    const run = startFirstRun(fresh);
    expect(goTo(run, 'voice')).toBe(run);
    const later = answered(run, false);
    expect(goTo(later, 'answer').current).toBe('answer');
    expect(chipState(later, 'answer')).toBe('done');
    expect(chipState(later, 'name')).toBe('current');
    expect(chipState(later, 'think')).toBe('ahead');
  });
});

describe('answerPatch', () => {
  const atName = answered(startFirstRun(fresh), false);
  const after = answered(atName, false);

  it('saves a name as given, with where setup got to', () => {
    expect(answerPatch({ step: 'name', name: 'Alex' }, fresh, after)).toEqual({
      userName: 'Alex',
      userNameDeclined: false,
      welcome: { done: false, step: 'think' },
    });
  });

  it('remembers a declined name, so it is never asked again', () => {
    expect(answerPatch({ step: 'name', name: '' }, fresh, answered(atName, true))).toEqual({
      userName: '',
      userNameDeclined: true,
      welcome: { done: false, step: 'think' },
    });
  });

  it('keeps what the welcome record already holds', () => {
    const saved = Settings.parse({ welcome: { done: false, step: 'think', answerBy: 'type' } });
    const next = answered(startFirstRun(saved), false);
    expect(answerPatch({ step: 'think', brain: 'openrouter' }, saved, next)).toEqual({
      welcome: { done: false, step: 'voice', answerBy: 'type', brain: 'openrouter' },
    });
  });

  it('never undoes a finished setup opened again', () => {
    const done = Settings.parse({ welcome: { done: true, step: 'try', brain: 'claude-code' } });
    const next = answered(answered(startFirstRun(done), false), false);
    expect(answerPatch({ step: 'name', name: 'Alex' }, done, next).welcome).toEqual({
      done: true,
      step: 'think',
      brain: 'claude-code',
    });
  });

  it('turns Scout’s voice on or off from the voice answer', () => {
    expect(answerPatch({ step: 'voice', talk: false }, fresh, after).voice).toEqual({
      ...SETTINGS_DEFAULTS.voice,
      enabled: false,
    });
  });
});

describe('listensNow', () => {
  const talk = Settings.parse({ welcome: { done: false, step: 'name', answerBy: 'talk' } });
  const type = Settings.parse({ welcome: { done: false, step: 'name', answerBy: 'type' } });
  const atAnswer = startFirstRun(fresh);
  const afterTalk = answered(atAnswer, false);

  it('stays off at the first question, before you choose', () => {
    expect(atAnswer.current).toBe('answer');
    expect(listensNow(atAnswer, fresh)).toBe(false);
  });

  it('stays off when a finished setup that was answered by talking is opened again', () => {
    const done = Settings.parse({ welcome: { done: true, step: 'try', answerBy: 'talk' } });
    const rerun = startFirstRun(done);
    expect(rerun).toMatchObject({ current: 'answer', reached: 'answer' });
    expect(listensNow(rerun, done)).toBe(false);
  });

  it('listens after "Talk to me", also back on the Answer chip', () => {
    expect(listensNow(afterTalk, talk)).toBe(true);
    expect(listensNow(goTo(afterTalk, 'answer'), talk)).toBe(true);
  });

  it('stops after "I\'ll type"', () => {
    expect(listensNow(afterTalk, type)).toBe(false);
  });

  it('stops when setup finishes at Try it', () => {
    let at = afterTalk;
    while (at.current !== 'try') at = answered(at, false);
    expect(listensNow(at, talk)).toBe(false);
  });

  it('listens again on a resumed setup that was answered by talking', () => {
    const saved = Settings.parse({ welcome: { done: false, step: 'think', answerBy: 'talk' } });
    expect(listensNow(startFirstRun(saved), saved)).toBe(true);
  });
});

describe('oneAtATime', () => {
  it('runs each step only after the one before has settled, failed or not', async () => {
    const queue = oneAtATime();
    const order: string[] = [];
    let fail = (): void => undefined;
    const first = queue(
      () =>
        new Promise<string>((_, reject) => {
          order.push('first');
          fail = () => reject(new Error('save failed'));
        }),
    );
    const second = queue(async () => {
      order.push('second');
      return 'saved';
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['first']);
    fail();
    await expect(first).rejects.toThrow('save failed');
    await expect(second).resolves.toBe('saved');
    expect(order).toEqual(['first', 'second']);
  });
});
