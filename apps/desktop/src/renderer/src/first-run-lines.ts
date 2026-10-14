import type { Settings, WelcomeStep } from '@tagalong/protocol';
import type { ClaudeSignIn, ProviderChoice } from '../../shared/ipc';
import type { FirstRunAnswer } from './first-run';

/** Everything a line depends on. The key itself is never here, so no line can carry it. */
export interface LineContext {
  petName: string;
  /** This is the first step on screen, so Scout says hello first. */
  first: boolean;
  signIn: ClaudeSignIn | null;
  /** "An API key" was chosen on the think step. */
  picking: boolean;
  /** The service the key is for, once picked. */
  keyLabel: string | null;
  askKey: string;
}

export interface StepOption {
  id: string;
  label: string;
  note?: string;
  suggested?: boolean;
}

export const STEP_NAMES: Record<WelcomeStep, string> = {
  answer: 'Answer',
  name: 'Name',
  think: 'How I think',
  voice: 'Voice',
  keys: 'Keys',
  try: 'Try it',
};

export function readableKey(accelerator: string): string {
  return accelerator.replace('CommandOrControl', 'Ctrl');
}

function thinkLine(ctx: LineContext): string {
  if (ctx.picking) {
    return ctx.keyLabel === null
      ? 'Which service is the key for? Anthropic, OpenRouter or Token Factory.'
      : `Paste your ${ctx.keyLabel} key below. I’ll test it once. Keys are typed or pasted, never spoken.`;
  }
  switch (ctx.signIn) {
    case 'signed-in':
      return 'Next: how should I think? You’re signed in to Claude already, so I’d use that. Say “Claude” or tap it.';
    case 'signed-out':
      return 'Claude Code is here but signed out. Sign in and I’ll wait, or use an API key.';
    case 'not-installed':
      return 'I didn’t find Claude Code. Install it and I’ll use your sign-in, or use an API key.';
    case 'unknown':
      return 'I couldn’t check your Claude sign-in. Check again, or use an API key.';
    default:
      return 'Checking how I can think…';
  }
}

export function scoutSays(step: WelcomeStep, ctx: LineContext): { title: string; line: string } {
  const hello = ctx.first ? `Hi, I’m ${ctx.petName}. ` : '';
  switch (step) {
    case 'answer':
      return {
        title: 'Talk or type?',
        line: `${hello}A few quick questions and we’re set. Will you talk to me, or type?`,
      };
    case 'name':
      return {
        title: 'What should I call you?',
        line: `${hello}What should I call you? I’ll use it when I say hello.`,
      };
    case 'think':
      return { title: 'How should I think?', line: thinkLine(ctx) };
    case 'voice':
      return {
        title: 'Should I talk?',
        line: 'This is how I sound. Shall I talk out loud, or keep to text?',
      };
    case 'keys':
      return {
        title: 'One key to remember',
        line: `Press ${ctx.askKey} anytime and ask me about whatever is on your screen.`,
      };
    case 'try':
      return { title: 'Try it', line: 'Off to the corner of your screen. Ask me one real thing.' };
  }
}

const KEY_OPTION: StepOption = {
  id: 'key',
  label: 'An API key',
  note: 'Anthropic, OpenRouter or Token Factory',
};

export function optionsFor(
  step: WelcomeStep,
  ctx: LineContext,
  providers: readonly ProviderChoice[],
): StepOption[] {
  switch (step) {
    case 'answer':
      return [
        { id: 'talk', label: 'Talk to me' },
        { id: 'type', label: 'I’ll type' },
      ];
    case 'name':
      return [{ id: 'declined', label: 'Rather not' }];
    case 'voice':
      return [
        { id: 'talk', label: 'Yes, talk', suggested: true },
        { id: 'text', label: 'Text only' },
      ];
    case 'keys':
      return [{ id: 'done', label: 'Got it', suggested: true }];
    case 'try':
      return [];
    case 'think':
      if (ctx.picking) {
        return providers
          .filter((provider) => provider.needsKey)
          .map((provider) =>
            provider.hasKey
              ? { id: provider.id, label: provider.label, note: 'Key stored' }
              : { id: provider.id, label: provider.label },
          );
      }
      switch (ctx.signIn) {
        case 'signed-in':
          return [
            {
              id: 'claude-code',
              label: 'Claude, with your sign-in',
              note: 'Found on this computer · signed in · Scout’s suggestion',
              suggested: true,
            },
            KEY_OPTION,
          ];
        case 'signed-out':
          return [
            {
              id: 'sign-in',
              label: 'Sign in to Claude',
              note: 'Opens a terminal. I’ll wait here.',
              suggested: true,
            },
            KEY_OPTION,
          ];
        case 'not-installed':
          return [
            { id: 'install', label: 'Install Claude Code', note: 'Then I can use your sign-in' },
            { id: 'check', label: 'I installed it, check again' },
            KEY_OPTION,
          ];
        default:
          return [{ id: 'check', label: 'Check again' }, KEY_OPTION];
      }
  }
}

export function notCaught(step: WelcomeStep, ctx: LineContext): string {
  switch (step) {
    case 'answer':
      return 'I didn’t catch that. Say “talk” or “type”, or tap one.';
    case 'name':
      return 'I didn’t catch a name. Type it, or say “rather not”.';
    case 'think':
      if (ctx.picking) return 'Which service? Say its name, or tap one.';
      return ctx.signIn === 'signed-in'
        ? 'I didn’t catch that. Say “Claude” or “API key”, or tap one.'
        : 'I didn’t catch that. Say “API key”, or tap one.';
    case 'voice':
      return 'I didn’t catch that. Say “yes” or “text only”, or tap one.';
    default:
      return 'Say “got it” when you’re ready.';
  }
}

function brainLabel(brain: string, providers: readonly ProviderChoice[]): string {
  return brain === 'claude-code'
    ? 'Claude'
    : (providers.find((provider) => provider.id === brain)?.label ?? brain);
}

export function echoFor(answer: FirstRunAnswer, providers: readonly ProviderChoice[]): string {
  switch (answer.step) {
    case 'answer':
      return answer.by === 'talk' ? 'Talking it is.' : 'Typing it is.';
    case 'name':
      return answer.name === ''
        ? 'No name, then. That’s fine.'
        : `Got it, I’ll call you ${answer.name}.`;
    case 'think':
      return `${brainLabel(answer.brain, providers)} it is.`;
    case 'voice':
      return answer.talk ? 'I’ll talk.' : 'Text only, then.';
    case 'keys':
      return 'Off I go.';
  }
}

/** A done chip says the answer given; current and ahead chips say the step's name. */
export function chipLabel(
  step: WelcomeStep,
  settings: Settings,
  providers: readonly ProviderChoice[],
): string {
  switch (step) {
    case 'answer':
      return settings.welcome.answerBy === 'talk' ? 'Talking' : 'Typing';
    case 'name':
      return settings.userName === '' ? 'No name' : `You: ${settings.userName}`;
    case 'think':
      return settings.welcome.brain === undefined
        ? STEP_NAMES.think
        : brainLabel(settings.welcome.brain, providers);
    case 'voice':
      return settings.voice.enabled ? 'Talks' : 'Text only';
    default:
      return STEP_NAMES[step];
  }
}
