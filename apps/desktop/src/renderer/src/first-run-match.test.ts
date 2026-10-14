import { describe, expect, it } from 'vitest';
import type { ProviderChoice } from '../../shared/ipc';
import { choicesFor, matchChoice, nameFrom } from './first-run-match';

const providers: ProviderChoice[] = [
  { id: 'claude-code', label: 'Your Claude sign-in', needsKey: false, hasKey: false },
  { id: 'openrouter', label: 'OpenRouter', needsKey: true, hasKey: false },
  { id: 'nebius', label: 'Nebius Token Factory', needsKey: true, hasKey: false },
  { id: 'anthropic', label: 'Anthropic', needsKey: true, hasKey: false },
];
const step = (name: 'answer' | 'voice' | 'keys') => choicesFor(name, null, false, providers);

describe('matchChoice', () => {
  it('matches typed or heard words to one choice', () => {
    expect(matchChoice('I’ll type', step('answer'))).toBe('type');
    expect(matchChoice('Talk to me!', step('answer'))).toBe('talk');
    expect(matchChoice('yes, talk', step('voice'))).toBe('talk');
    expect(matchChoice('No. Text only.', step('voice'))).toBe('text');
    expect(matchChoice('got it', step('keys'))).toBe('done');
  });

  it('asks again rather than guess when the words fit two choices or none', () => {
    expect(matchChoice('okay no', step('voice'))).toBeNull();
    expect(matchChoice('don’t talk, I’ll type', step('answer'))).toBeNull();
    expect(matchChoice('banana', step('voice'))).toBeNull();
    expect(matchChoice('   ', step('keys'))).toBeNull();
    expect(matchChoice('okay no', step('keys'))).toBeNull();
    expect(matchChoice('okay, no thanks', step('keys'))).toBeNull();
    const think = choicesFor('think', 'signed-in', false, providers);
    expect(matchChoice('okay no', think)).toBeNull();
    expect(matchChoice('okay, no thanks', think)).toBeNull();
    expect(matchChoice('nope, sure', think)).toBeNull();
  });

  it('matches whole words only', () => {
    expect(matchChoice('typewriter', step('answer'))).toBeNull();
    expect(matchChoice('I know', step('voice'))).toBeNull();
  });
});

describe('choicesFor think', () => {
  it('offers Claude only when it is signed in', () => {
    expect(matchChoice('Claude', choicesFor('think', 'signed-in', false, providers))).toBe(
      'claude-code',
    );
    expect(matchChoice('Claude', choicesFor('think', 'signed-out', false, providers))).toBeNull();
    expect(matchChoice('an API key', choicesFor('think', 'signed-out', false, providers))).toBe(
      'key',
    );
  });

  it('names the keyed services once a key is chosen, never the sign-in', () => {
    const picking = choicesFor('think', 'signed-in', true, providers);
    expect(matchChoice('open router', picking)).toBe('openrouter');
    expect(matchChoice('token factory', picking)).toBe('nebius');
    expect(matchChoice('Anthropic', picking)).toBe('anthropic');
    expect(picking.map((choice) => choice.id)).not.toContain('claude-code');
  });

  it('goes back from the keyed services when asked', () => {
    const picking = choicesFor('think', 'signed-in', true, providers);
    expect(matchChoice('go back', picking)).toBe('back');
    expect(matchChoice('back', picking)).toBe('back');
  });

  it('has nothing to match on the name step: the name is free text', () => {
    expect(choicesFor('name', null, false, providers)).toEqual([]);
  });
});

describe('negation', () => {
  it('never counts a negated phrase as a vote', () => {
    expect(matchChoice('don’t talk', step('voice'))).toBeNull();
    expect(matchChoice('don’t talk to me', step('answer'))).toBeNull();
    expect(matchChoice('I’m not ready', step('keys'))).toBeNull();
    expect(
      matchChoice('not Claude', choicesFor('think', 'signed-in', false, providers)),
    ).toBeNull();
  });
});

describe('nameFrom refusals', () => {
  it('does not save a refusal or a greeting as a name', () => {
    for (const text of [
      'I’m not telling',
      'I don’t know',
      'yes please',
      'hello',
      'nothing',
      'dunno',
      'Never mind',
    ]) {
      expect(nameFrom(text)).toBeNull();
    }
    expect(nameFrom('I would rather not')).toBe('declined');
  });
});

describe('nameFrom', () => {
  it('takes the name typed, as written', () => {
    expect(nameFrom('Alex')).toEqual({ name: 'Alex' });
    expect(nameFrom('  Mary Jane ')).toEqual({ name: 'Mary Jane' });
  });

  it('takes the name out of a heard sentence and gives it capitals', () => {
    expect(nameFrom('my name is alex.')).toEqual({ name: 'Alex' });
    expect(nameFrom('call me jo')).toEqual({ name: 'Jo' });
    expect(nameFrom('I’m Sam')).toEqual({ name: 'Sam' });
  });

  it('hears a no as declining, but not a name that starts like one', () => {
    for (const no of ['Rather not', 'no', 'No thanks.', 'skip', 'I’d rather not']) {
      expect(nameFrom(no)).toBe('declined');
    }
    expect(nameFrom('Noah')).toEqual({ name: 'Noah' });
  });

  it('never takes a pasted key or a long sentence as a name', () => {
    expect(nameFrom('sk-or-v1-0123456789abcdef0123456789')).toBeNull();
    expect(nameFrom('I really do not know what to say here')).toBeNull();
    expect(nameFrom('')).toBeNull();
  });
});
