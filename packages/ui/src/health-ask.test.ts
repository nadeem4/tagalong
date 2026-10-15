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
    'is something wrong?',
  ])('matches %j', (text) => {
    expect(wantsHealthCheck(text)).toBe(true);
  });

  it.each([
    "what's wrong with this code",
    'what is wrong with my test?',
    'are you ok with me pushing this?',
    'check my health insurance form',
    'explain this error',
    '',
  ])('leaves %j to Scout', (text) => {
    expect(wantsHealthCheck(text)).toBe(false);
  });
});
