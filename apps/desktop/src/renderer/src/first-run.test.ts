/**
 * Tests for Welcome's step machine: start and resume, answers, chips, what is saved, when it
 * listens.
 */
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS, Settings } from '@tagalong/protocol';
import {
  answerPatch,
  answered,
  chipState,
  goTo,
  listensNow,
  oneAtATime,
  startFirstRun,
  stepsFor,
} from './first-run';

const fresh = Settings.parse({});

describe('stepsFor', () => {
  it('asks how you answer only when setup can listen', () => {
    expect(stepsFor(true)).toEqual(['answer', 'name', 'think', 'voice', 'keys', 'try']);
    expect(stepsFor(false)).toEqual(['name', 'think', 'voice', 'keys', 'try']);
  });
});

describe('startFirstRun', () => {
  it('starts a new install at the first step', () => {
    expect(startFirstRun(fresh, false)).toEqual({
      steps: stepsFor(false),
      current: 'name',
      reached: 'name',
    });
  });

  it('resumes at the step reached last time', () => {
    const saved = Settings.parse({ welcome: { done: false, step: 'voice' } });
    expect(startFirstRun(saved, false)).toMatchObject({ current: 'voice', reached: 'voice' });
  });

  it('starts again at the top when a finished setup is opened again', () => {
    const done = Settings.parse({ welcome: { done: true, step: 'try' } });
    expect(startFirstRun(done, false)).toMatchObject({ current: 'name', reached: 'name' });
  });

  it('never asks the name again once it was declined', () => {
    const declined = Settings.parse({
      welcome: { done: true, step: 'try' },
      userNameDeclined: true,
    });
    expect(startFirstRun(declined, false)).toMatchObject({ current: 'think', reached: 'think' });
  });

  it('starts at the first step when the saved one is not offered here', () => {
    const saved = Settings.parse({ welcome: { done: false, step: 'answer' } });
    expect(startFirstRun(saved, false).current).toBe('name');
  });
});

describe('answered', () => {
  const run = startFirstRun(fresh, false);

  it('moves on to the next step by itself', () => {
    expect(answered(run, false)).toMatchObject({ current: 'think', reached: 'think' });
  });

  it('after going back with a chip, returns to the furthest step reached', () => {
    const atVoice = answered(answered(run, false), false);
    const back = goTo(atVoice, 'name');
    expect(back.current).toBe('name');
    expect(answered(back, false)).toMatchObject({ current: 'voice', reached: 'voice' });
  });

  it('skips the name when it was declined', () => {
    expect(startFirstRun(Settings.parse({ userNameDeclined: true }), false).current).toBe('think');
  });

  it('after How to answer, a declined name is skipped', () => {
    const declined = Settings.parse({ userNameDeclined: true });
    expect(answered(startFirstRun(declined, true), true).current).toBe('think');
  });

  it('ends on Try it and stays there', () => {
    let at = run;
    for (let i = 0; i < 4; i += 1) at = answered(at, false);
    expect(at.current).toBe('try');
    expect(answered(at, false).current).toBe('try');
  });
});

describe('goTo and chipState', () => {
  it('opens only steps already reached', () => {
    const run = startFirstRun(fresh, false);
    expect(goTo(run, 'voice')).toBe(run);
    const later = answered(run, false);
    expect(goTo(later, 'name').current).toBe('name');
    expect(chipState(later, 'name')).toBe('done');
    expect(chipState(later, 'think')).toBe('current');
    expect(chipState(later, 'voice')).toBe('ahead');
  });
});

describe('answerPatch', () => {
  const run = startFirstRun(fresh, false);
  const after = answered(run, false);

  it('saves a name as given, with where setup got to', () => {
    expect(answerPatch({ step: 'name', name: 'Alex' }, fresh, after)).toEqual({
      userName: 'Alex',
      userNameDeclined: false,
      welcome: { done: false, step: 'think' },
    });
  });

  it('remembers a declined name, so it is never asked again', () => {
    expect(answerPatch({ step: 'name', name: '' }, fresh, answered(run, true))).toEqual({
      userName: '',
      userNameDeclined: true,
      welcome: { done: false, step: 'think' },
    });
  });

  it('keeps what the welcome record already holds', () => {
    const saved = Settings.parse({ welcome: { done: false, step: 'think', answerBy: 'type' } });
    const next = answered(startFirstRun(saved, false), false);
    expect(answerPatch({ step: 'think', brain: 'openrouter' }, saved, next)).toEqual({
      welcome: { done: false, step: 'voice', answerBy: 'type', brain: 'openrouter' },
    });
  });

  it('never undoes a finished setup opened again', () => {
    const done = Settings.parse({ welcome: { done: true, step: 'try', brain: 'claude-code' } });
    const next = answered(startFirstRun(done, false), false);
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
  const atAnswer = startFirstRun(fresh, true);
  const afterTalk = answered(atAnswer, false);

  it('stays off at the first question, before you choose', () => {
    expect(atAnswer.current).toBe('answer');
    expect(listensNow(atAnswer, fresh)).toBe(false);
  });

  it('stays off when a finished setup that was answered by talking is opened again', () => {
    const done = Settings.parse({ welcome: { done: true, step: 'try', answerBy: 'talk' } });
    const rerun = startFirstRun(done, true);
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
    expect(listensNow(startFirstRun(saved, true), saved)).toBe(true);
  });

  it('never listens without the Answer step', () => {
    expect(listensNow(answered(startFirstRun(talk, false), false), talk)).toBe(false);
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
