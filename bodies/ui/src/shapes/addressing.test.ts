/** Tests for spotting a turn addressed to Scout and the "stop listening" phrases. */
import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_MS, addressedToScout, isStopListening, mightBeStop } from './addressing';

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

  // Speech to text often mishears the name: a leading word that sounds like "Scout" counts.
  it.each([
    ['Scott, what is this?', 'what is this?'],
    ['scot what is this', 'what is this'],
    ['Scoot, help me', 'help me'],
    ['Skout, help me', 'help me'],
    ['Scouts, what is this?', 'what is this?'],
    ['Hey Scott, explain this.', 'explain this.'],
    ['ok skott: help', 'help'],
  ])('sounds like the name: %j -> %j', (text, rest) => {
    expect(addressedToScout(text)).toBe(rest);
  });

  it.each([
    "Scott's car is outside",
    'Scout’s answer was long',
    "scout's",
    'Scope this out for me',
    'About the meeting today',
    'Count me in for lunch',
    'Shout if you need me',
    'Scotland is lovely',
    'Hey, what is this',
    'Okay. Fine.',
  ])('%j does not sound like talk to Scout', (text) => {
    expect(addressedToScout(text)).toBeNull();
  });

  it('in the follow-up window, any words are the question, the name taken off if said', () => {
    expect(addressedToScout('and what about tomorrow?', { followUp: true })).toBe(
      'and what about tomorrow?',
    );
    expect(addressedToScout('Scout, and then?', { followUp: true })).toBe('and then?');
    expect(addressedToScout('   ', { followUp: true })).toBeNull();
    expect(addressedToScout('and what about tomorrow?', { followUp: false })).toBeNull();
  });

  it('the follow-up window lasts about twenty seconds', () => {
    expect(FOLLOW_UP_MS).toBe(20_000);
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
