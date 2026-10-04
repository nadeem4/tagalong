import { describe, expect, it } from 'vitest';
import type { Pet } from '@tagalong/protocol';
import { parseCrewCommand } from './commands';

const base = {
  avatar: '*',
  persona: '',
  model: 'fake-model',
  providerId: 'fake',
  toolAllowlist: [],
  replyStyle: 'text' as const,
};
const crew: Pet[] = [
  { ...base, id: 'scout', name: 'Scout' },
  { ...base, id: 'ink', name: 'Ink' },
  { ...base, id: 'bolt', name: 'Bolt' },
];

describe('parseCrewCommand', () => {
  it('reads a leading @mention of another pet as a handoff, by name or id, any case', () => {
    expect(parseCrewCommand('@Ink draft a reply to this', crew, 'scout')).toEqual({
      kind: 'handoff',
      target: crew[1],
      request: 'draft a reply to this',
    });
    expect(parseCrewCommand('  @bolt, why does this fail?', crew, 'scout')).toMatchObject({
      kind: 'handoff',
      target: { id: 'bolt' },
      request: 'why does this fail?',
    });
  });

  it('hands off with an empty request when the mention stands alone', () => {
    expect(parseCrewCommand('@Ink', crew, 'scout')).toMatchObject({
      kind: 'handoff',
      request: '',
    });
  });

  it('treats a mention of the pet already being asked as a plain ask without the mention', () => {
    expect(parseCrewCommand('@Scout what is this?', crew, 'scout')).toEqual({
      kind: 'ask',
      text: 'what is this?',
    });
  });

  it('leaves an unknown mention, and a mention mid-sentence, as ordinary text', () => {
    expect(parseCrewCommand('@Nobody hello', crew, 'scout')).toEqual({
      kind: 'ask',
      text: '@Nobody hello',
    });
    expect(parseCrewCommand('ask @Ink later', crew, 'scout')).toEqual({
      kind: 'ask',
      text: 'ask @Ink later',
    });
  });

  it('reads /crew as a roundtable on the rest of the line', () => {
    expect(parseCrewCommand('/crew Should the panel dock left?', crew, 'scout')).toEqual({
      kind: 'roundtable',
      question: 'Should the panel dock left?',
    });
    expect(parseCrewCommand('/CREW  tabs or spaces', crew, 'scout')).toMatchObject({
      kind: 'roundtable',
      question: 'tabs or spaces',
    });
  });

  it('does not start a roundtable with no question', () => {
    expect(parseCrewCommand('/crew   ', crew, 'scout')).toEqual({ kind: 'ask', text: '/crew' });
    expect(parseCrewCommand('/crewmate hi', crew, 'scout')).toEqual({
      kind: 'ask',
      text: '/crewmate hi',
    });
  });
});
