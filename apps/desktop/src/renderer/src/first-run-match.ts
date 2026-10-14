import type { WelcomeStep } from '@tagalong/protocol';
import type { ClaudeSignIn, ProviderChoice } from '../../shared/ipc';
import { cleanUserName } from './settings-form';

/**
 * Setup's answers are fixed choices, so typed text and local speech-to-text are matched
 * here with no AI. A match needs exactly one choice; two or none and Scout asks again.
 */
export interface Choice {
  id: string;
  says: readonly string[];
}

/** Lowercase words only: apostrophes dropped ("I'll" is "ill"), everything else a space. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchChoice(text: string, choices: readonly Choice[]): string | null {
  const heard = ` ${normalise(text)} `;
  if (heard.trim() === '') return null;
  const phrases = choices.map((choice) => choice.says.map((phrase) => ` ${normalise(phrase)} `));
  // A negated phrase ("don't talk") is not a vote for anything, and not for its opposite.
  if (phrases.flat().some((phrase) => NEGATORS.some((no) => heard.includes(` ${no}${phrase}`)))) {
    return null;
  }
  // A "no" that no choice lists is a refusal of something, not a vote for "okay".
  const refuses = / (?:no|nope) /;
  if (refuses.test(heard) && !phrases.flat().some((phrase) => refuses.test(phrase))) return null;
  const hits = choices.filter((_, index) =>
    phrases[index]!.some((phrase) => heard.includes(phrase)),
  );
  return hits.length === 1 ? hits[0]!.id : null;
}

/** "no" is left out: it is also an answer ("No. Text only."). */
const NEGATORS = ['dont', 'do not', 'not', 'never', 'wont', 'cant'];

const ANSWER: Choice[] = [
  { id: 'talk', says: ['talk', 'talk to me', 'speak', 'voice', 'out loud'] },
  { id: 'type', says: ['type', 'typing', 'keyboard', 'write'] },
];
const VOICE: Choice[] = [
  { id: 'talk', says: ['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'talk', 'speak', 'out loud'] },
  { id: 'text', says: ['no', 'nope', 'text', 'text only', 'quiet', 'silent'] },
];
const KEYS: Choice[] = [
  { id: 'done', says: ['got it', 'ok', 'okay', 'done', 'next', 'ready', 'yes', 'sure', 'fine'] },
];
const CLAUDE: Choice = {
  id: 'claude-code',
  says: ['claude', 'claude code', 'sign in', 'my sign in', 'yes', 'sure', 'ok', 'okay'],
};
const SIGN_IN: Choice = { id: 'sign-in', says: ['sign in', 'log in', 'login'] };
const INSTALL: Choice = { id: 'install', says: ['install', 'install it'] };
const CHECK: Choice = { id: 'check', says: ['check', 'check again', 'installed', 'try again'] };
const BACK: Choice = { id: 'back', says: ['back', 'go back'] };
const KEY: Choice = { id: 'key', says: ['key', 'api', 'api key', 'a key'] };
const SERVICE_WORDS: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['anthropic'],
  openrouter: ['openrouter', 'open router'],
  nebius: ['nebius', 'token factory'],
};

export function choicesFor(
  step: WelcomeStep,
  signIn: ClaudeSignIn | null,
  picking: boolean,
  providers: readonly ProviderChoice[],
): Choice[] {
  switch (step) {
    case 'answer':
      return ANSWER;
    case 'voice':
      return VOICE;
    case 'keys':
      return KEYS;
    case 'think':
      if (picking) {
        return [
          ...providers
            .filter((provider) => provider.needsKey)
            .map((provider) => ({
              id: provider.id,
              says: SERVICE_WORDS[provider.id] ?? [provider.label],
            })),
          BACK,
        ];
      }
      // These mirror the buttons optionsFor shows for each sign-in state.
      switch (signIn) {
        case 'signed-in':
          return [CLAUDE, KEY];
        case 'signed-out':
          return [SIGN_IN, KEY];
        case 'not-installed':
          return [INSTALL, CHECK, KEY];
        default:
          return [CHECK, KEY];
      }
    default:
      return [];
  }
}

const DECLINES = [
  'rather not',
  'id rather not',
  'i would rather not',
  'no',
  'no thanks',
  'nope',
  'skip',
  'pass',
  'prefer not',
  'id prefer not',
];
const NOT_NAMES = new Set([
  'yes',
  'yes please',
  'nope',
  'ok',
  'okay',
  'sure',
  'hello',
  'hi',
  'nothing',
  'dunno',
  'i dont know',
]);
const LEAD_IN = /^(?:my name is|my name['’]s|call me|i['’]m|i am|it['’]s|it is)\s+/i;

/**
 * A name from what was typed or heard, a decline, or null when it is not a name (a pasted
 * key, digits, a sentence): Scout then asks again rather than save it.
 */
export function nameFrom(text: string): { name: string } | 'declined' | null {
  const heard = normalise(text);
  if (heard === '') return null;
  if (DECLINES.some((phrase) => heard === phrase || heard.startsWith(`${phrase} `)))
    return 'declined';
  if (NOT_NAMES.has(heard) || /^(?:(?:i am|im|i) )?(?:not|dont|never)\b/.test(heard)) return null;
  const said = text
    .trim()
    .replace(LEAD_IN, '')
    .replace(/[.!?,;:]+$/u, '')
    .trim();
  const words = said.split(/\s+/);
  if (
    said === '' ||
    /\d/.test(said) ||
    words.length > 3 ||
    words.some((word) => word.length > 20)
  ) {
    return null;
  }
  // Typed names keep their capitals; speech comes back lowercase, so it gets them.
  const name =
    said === said.toLowerCase()
      ? words.map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`).join(' ')
      : said;
  return { name: cleanUserName(name) };
}
