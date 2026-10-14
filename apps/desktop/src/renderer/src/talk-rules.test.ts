import { describe, expect, it } from 'vitest';
import { FailureStreak, keyStarts, settles, shownPartial } from './talk-rules';

describe('keyStarts', () => {
  it('starts a held question when nothing listens, or a held one already ended', () => {
    expect(keyStarts(null)).toBe(true);
  });

  it('does nothing while listening all the time: Scout already hears, "Scout" asks', () => {
    expect(keyStarts('always')).toBe(false);
  });
});

describe('settles', () => {
  it('lets the bubble go quiet when no held question is being asked', () => {
    expect(settles(null)).toBe(true);
    // An always question heard, or a held one heard after always listening resumed.
    expect(settles('always')).toBe(true);
  });

  it('leaves a held question that has already started alone', () => {
    expect(settles('held')).toBe(false);
  });
});

describe('shownPartial', () => {
  it('shows the question without the name it starts with', () => {
    expect(shownPartial('Scout, what am I looking at')).toBe('what am I looking at');
    expect(shownPartial('hey Scout what time is it')).toBe('what time is it');
  });

  it('shows the words as heard when they do not start with the name', () => {
    expect(shownPartial('what am I looking at')).toBe('what am I looking at');
    expect(shownPartial('Scout')).toBe('Scout');
  });

  it('shows nothing when nothing was heard', () => {
    expect(shownPartial(null)).toBeNull();
    expect(shownPartial('')).toBeNull();
  });
});

describe('FailureStreak', () => {
  it('tells the first failure of a streak only', () => {
    const streak = new FailureStreak();
    expect(streak.fail()).toBe(true);
    expect(streak.fail()).toBe(false);
    expect(streak.fail()).toBe(false);
  });

  it('tells again once the streak is broken', () => {
    const streak = new FailureStreak();
    streak.fail();
    streak.clear();
    expect(streak.fail()).toBe(true);
  });
});
