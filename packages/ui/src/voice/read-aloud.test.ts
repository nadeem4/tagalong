import { describe, expect, it } from 'vitest';
import { goesOn, wantsReadAloud } from './read-aloud';

describe('wantsReadAloud', () => {
  it.each([
    'read this to me',
    'Scout, read this to me',
    'read it aloud',
    'Say that out loud',
    'can you READ the selection out loud?',
    'translate this and read it to me',
    'Scout, translate it and read it to me',
    'translate this to English and then read it aloud',
  ])('matches "%s"', (text) => {
    expect(wantsReadAloud(text)).toBe(true);
  });

  it.each([
    'I read it yesterday',
    'read the docs and fix it',
    'what does this say',
    'how do I read this file?',
    'read the logs and explain the error to me',
    'why did you say that to me?',
    'translate this',
    'translate this to me',
    'translate the docs and explain the error to me',
    'translate this file to TypeScript',
    'how do I translate strings in React?',
    'translate the error and fix it',
  ])('does not match "%s"', (text) => {
    expect(wantsReadAloud(text)).toBe(false);
  });

  it('does not match an empty or blank line', () => {
    expect(wantsReadAloud('')).toBe(false);
    expect(wantsReadAloud('   ')).toBe(false);
  });

  it('does not match "aloud" or "to me" without read or say', () => {
    expect(wantsReadAloud('explain this to me')).toBe(false);
    expect(wantsReadAloud('laugh out loud')).toBe(false);
  });

  it('does not match words that only contain read or say', () => {
    expect(wantsReadAloud('is the thread ready to me?')).toBe(false);
    expect(wantsReadAloud('the essay out loud')).toBe(false);
  });
});

describe('goesOn', () => {
  it.each(['go on', 'Go on.', 'yes', 'Yes please', 'continue', 'keep going!', 'please go on'])(
    'matches "%s"',
    (text) => {
      expect(goesOn(text)).toBe(true);
    },
  );

  it.each([
    'yes, but what is this error?',
    'how do I go on from here?',
    'continue the build in the terminal',
    'what does this chart show',
    '',
  ])('does not match "%s"', (text) => {
    expect(goesOn(text)).toBe(false);
  });
});
