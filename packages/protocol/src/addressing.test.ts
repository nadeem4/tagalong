/** Tests for spotting a turn addressed to Scout and the "stop listening" phrases. */
import { describe, expect, it } from 'vitest';
import { addressedToScout, isStopListening, mightBeStop } from './addressing';

describe('addressedToScout', () => {
  it.each([
    ['Scout, what is this?', 'what is this?'],
    ['scout what is this', 'what is this'],
    ['Hey Scout, explain this.', 'explain this.'],
    ['Okay, Scout. Explain.', 'Explain.'],
    ['OK scout: help', 'help'],
    ['Scout — help', 'help'],
    ['Okay Scout what’s this', 'what’s this'],
    ['  SCOUT, Help  ', 'Help'],
  ])('%j -> %j', (text, rest) => {
    expect(addressedToScout(text)).toBe(rest);
  });

  it.each([
    '  Scout!  ',
    'Scout',
    'Scouting is fun',
    'What is this, Scout?',
    'hey what is this',
    '',
    "Scout's the best",
    'Scout’s the best',
    'Scout-like thing',
    'Scout…',
    'Scout.',
    'Hey, Scout!',
  ])('%j is not addressed', (text) => {
    expect(addressedToScout(text)).toBeNull();
  });
});

describe('isStopListening', () => {
  it.each(['stop', 'Stop.', 'stop listening!'])('%j stops', (text) => {
    expect(isStopListening(text)).toBe(true);
  });

  it('hears the rest of "Scout, stop."', () => {
    expect(isStopListening(addressedToScout('Scout, stop.')!)).toBe(true);
  });

  it.each(['stop the build', 'what is stop'])('%j does not', (text) => {
    expect(isStopListening(text)).toBe(false);
  });
});

describe('mightBeStop', () => {
  it.each(['st', 'sto', 'stop', 'Stop list', 'stop listening.', 'S'])(
    '%j may still become "stop listening"',
    (text) => {
      expect(mightBeStop(text)).toBe(true);
    },
  );

  it.each(['sta', 'what', 'stop the', ''])('%j cannot', (text) => {
    expect(mightBeStop(text)).toBe(false);
  });
});
