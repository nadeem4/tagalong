import { describe, expect, it } from 'vitest';
import { addressedToScout, isStopListening } from './addressing';

describe('addressedToScout', () => {
  it.each([
    ['Scout, what is this?', 'what is this?'],
    ['scout what is this', 'what is this'],
    ['Hey Scout, explain this.', 'explain this.'],
    ['Okay, Scout. Explain.', 'Explain.'],
    ['OK scout: help', 'help'],
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
  ])('%j is not addressed', (text) => {
    expect(addressedToScout(text)).toBeNull();
  });
});

describe('isStopListening', () => {
  it.each(['stop', 'Stop.', 'stop listening!'])('%j stops', (text) => {
    expect(isStopListening(text)).toBe(true);
  });

  it.each(['stop the build', 'what is stop'])('%j does not', (text) => {
    expect(isStopListening(text)).toBe(false);
  });
});
