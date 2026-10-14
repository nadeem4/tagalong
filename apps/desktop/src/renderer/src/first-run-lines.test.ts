import { describe, expect, it } from 'vitest';
import { Settings } from '@tagalong/protocol';
import type { ProviderChoice } from '../../shared/ipc';
import {
  KEY_LINES,
  LISTENING_HINT,
  chipLabel,
  echoFor,
  listenFailed,
  listeningHint,
  notCaught,
  optionsFor,
  readableKey,
  scoutSays,
} from './first-run-lines';
import type { LineContext } from './first-run-lines';

const providers: ProviderChoice[] = [
  { id: 'openrouter', label: 'OpenRouter', needsKey: true, hasKey: false },
  { id: 'anthropic', label: 'Anthropic', needsKey: true, hasKey: true },
];
const ctx: LineContext = {
  petName: 'Scout',
  first: true,
  signIn: 'signed-in',
  picking: false,
  keyLabel: null,
  askKey: 'Ctrl+Shift+Space',
};

describe('scoutSays', () => {
  it('asks the name plainly and says why, introducing itself when it is the first step', () => {
    expect(scoutSays('name', ctx)).toEqual({
      title: 'What should I call you?',
      line: 'Hi, I’m Scout. What should I call you? I’ll use it when I say hello.',
    });
    expect(scoutSays('name', { ...ctx, first: false }).line).toBe(
      'What should I call you? I’ll use it when I say hello.',
    );
  });

  it('suggests the Claude sign-in when it is signed in, and waits when it is not', () => {
    expect(scoutSays('think', ctx).line).toContain(
      'You’re signed in to Claude already, so I’d use that.',
    );
    expect(scoutSays('think', { ...ctx, signIn: 'signed-out' }).line).toContain('I’ll wait');
    expect(scoutSays('think', { ...ctx, signIn: 'not-installed' }).line).toContain(
      'didn’t find Claude Code',
    );
  });

  it('asks for a key to be pasted, never spoken, and never repeats it', () => {
    const line = scoutSays('think', { ...ctx, picking: true, keyLabel: 'OpenRouter' }).line;
    expect(line).toBe(
      'Paste your OpenRouter key below. I’ll test it once. Keys are typed or pasted, never spoken.',
    );
  });

  it('plays a sample line before asking about voice', () => {
    expect(scoutSays('voice', ctx)).toEqual({
      title: 'Should I talk?',
      line: 'This is how I sound. Shall I talk out loud, or keep to text?',
    });
  });
});

describe('optionsFor', () => {
  it('names the pet that suggests', () => {
    const note = optionsFor('think', { ...ctx, petName: 'Pixel' }, providers)[0]?.note;
    expect(note).toContain('Pixel’s suggestion');
  });

  it('marks Scout’s suggestion and offers a key instead', () => {
    expect(
      optionsFor('think', ctx, providers).map((option) => [option.id, option.suggested === true]),
    ).toEqual([
      ['claude-code', true],
      ['key', false],
    ]);
  });

  it('offers sign-in, install or check again by what the sign-in check found', () => {
    expect(optionsFor('think', { ...ctx, signIn: 'signed-out' }, providers)[0]?.id).toBe('sign-in');
    expect(
      optionsFor('think', { ...ctx, signIn: 'not-installed' }, providers).map((o) => o.id),
    ).toEqual(['install', 'check', 'key']);
    expect(optionsFor('think', { ...ctx, signIn: 'unknown' }, providers).map((o) => o.id)).toEqual([
      'check',
      'key',
    ]);
  });

  it('lists the keyed services once a key is chosen, saying which have one stored', () => {
    expect(optionsFor('think', { ...ctx, picking: true }, providers)).toEqual([
      { id: 'openrouter', label: 'OpenRouter' },
      { id: 'anthropic', label: 'Anthropic', note: 'Key stored' },
      { id: 'back', label: 'Back', note: 'To the other ways I can think' },
    ]);
  });

  it('says plainly when there is no key to check, or the check could not run', () => {
    expect(KEY_LINES.empty).toBe('Paste a key first.');
    expect(KEY_LINES.untested).toBe('I couldn’t test that key just now. Try again.');
  });

  it('offers Rather not on the name step', () => {
    expect(optionsFor('name', ctx, providers)).toEqual([{ id: 'declined', label: 'Rather not' }]);
  });
});

describe('echoes, misses and chips', () => {
  it('says back what it heard', () => {
    expect(echoFor({ step: 'name', name: 'Alex' }, providers)).toBe('Got it, I’ll call you Alex.');
    expect(echoFor({ step: 'name', name: '' }, providers)).toBe('No name, then. That’s fine.');
    expect(echoFor({ step: 'think', brain: 'openrouter' }, providers)).toBe('OpenRouter it is.');
    expect(echoFor({ step: 'voice', talk: false }, providers)).toBe('Text only, then.');
  });

  it('asks again plainly when it did not catch the answer', () => {
    expect(notCaught('voice', ctx)).toBe(
      'I didn’t catch that. Say “yes” or “text only”, or tap one.',
    );
    expect(notCaught('name', ctx)).toBe('I didn’t catch a name. Type it, or say “rather not”.');
  });

  it('labels a done chip with the answer given', () => {
    const settings = Settings.parse({
      userName: 'Alex',
      welcome: { done: false, brain: 'claude-code' },
    });
    expect(chipLabel('name', settings, providers)).toBe('You: Alex');
    expect(chipLabel('think', settings, providers)).toBe('Claude');
    expect(chipLabel('name', Settings.parse({ userNameDeclined: true }), providers)).toBe(
      'No name',
    );
    expect(chipLabel('voice', Settings.parse({}), providers)).toBe('Talks');
  });

  it('writes a key the way a person reads it', () => {
    expect(readableKey('CommandOrControl+Shift+Space')).toBe('Ctrl+Shift+Space');
  });
});

describe('listening lines', () => {
  it('says plainly why it cannot listen, and that typing carries on', () => {
    expect(listenFailed('no-mic')).toBe(
      'I can’t find a microphone, so let’s type. Tap or type your answers.',
    );
    expect(listenFailed('denied')).toBe(
      'I wasn’t allowed to use the microphone, so let’s type. You can allow it later in Windows settings.',
    );
    expect(listenFailed('model-failed')).toBe(
      'My listening model didn’t download, so let’s type for now.',
    );
  });

  it('shows the speech model’s download, then that it is listening', () => {
    expect(listeningHint(0.4)).toBe('Getting my ears ready… 40%. Type or tap meanwhile.');
    expect(listeningHint(null)).toBe('Listening for your answer');
    expect(LISTENING_HINT).toBe(
      'Answer by voice, typing or a tap and I move on. Tap a step above to change it.',
    );
  });
});
