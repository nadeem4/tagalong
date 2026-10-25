/** Tests for wantsHealthCheck: which questions get the health card. */

import { describe, expect, it } from 'vitest';
import { wantsHealthCheck } from './health-ask';

describe('wantsHealthCheck', () => {
  it.each([
    "what's wrong",
    'Scout, what’s wrong?',
    'what is wrong?',
    'are you ok',
    'Are you OK, Scout?',
    'are you okay?',
    'health check',
    'Scout, run a health check',
    "why can't you hear me",
    'Why can’t you hear me?',
    'is something wrong with you?',
    "what's the matter with you, Scout?",
    'Hey Scout, are you alright?',
  ])('matches %j', (text) => {
    expect(wantsHealthCheck(text)).toBe(true);
  });

  it.each([
    "what's wrong with this code",
    'what is wrong with my test?',
    'are you ok with me pushing this?',
    'check my health insurance form',
    'explain this error',
    // Questions about the person's work, not about Scout: a turn, never the card.
    "Scout, what's wrong with this code?",
    "what's wrong here?",
    "what's broken?",
    'is something wrong?',
    'is anything broken?',
    'are you working?',
    'are you working on it?',
    'are you ok to review this PR?',
    'health check the API',
    'can you add a health check endpoint?',
    'why can’t you see my screen?',
    "what's wrong with the build",
    '',
  ])('leaves %j to Scout', (text) => {
    expect(wantsHealthCheck(text)).toBe(false);
  });
});
