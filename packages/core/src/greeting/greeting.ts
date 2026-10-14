import type { GreetingComposeResult, Pet, Settings } from '@tagalong/protocol';
import type { BrainProvider } from '../providers';

/**
 * The one line a pet says when the app opens, after the first time.
 *
 * It reads no screen: only the time of day, how long since the app last opened, and the
 * hand-offs that finished since then, and the person's name when they gave one. One short call to the summaries model writes it; a
 * handwritten line stands in when that fails, is slow, or comes back unusable, so the
 * greeting never waits on a provider that is not set up yet.
 */

/** A hand-off that finished while the app was closed: who did it and the brief it got. */
export interface FinishedHandoff {
  expertName: string;
  text: string;
}

export interface GreetingContext {
  /** Read in local time: "morning" means the person's morning. */
  now: Date;
  /** When the person was last with Tagalong (its last quit); null when nothing was recorded. */
  awaySince: Date | null;
  handoffs: readonly FinishedHandoff[];
  /** What the person asked to be called; empty or absent for no name. */
  userName?: string;
}

/**
 * A greeting is a nicety, said as the app opens: if the brain has not answered in this
 * long, say the fallback. A cold `claude -p` takes several seconds to start, so with the
 * Claude Code sign-in the fallback is what is usually said, at once rather than late.
 */
export const GREETING_TIMEOUT_MS = 1_200;

const GREETING_MAX_TOKENS = 60;
const MAX_WORDS = 25;
const MAX_CHARS = 160;
const BRIEF_CHARS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

const GREETING_INSTRUCTIONS = [
  'You are a small desktop companion. The app has just opened; write the one line you say.',
  'One sentence, under 20 words. Warm and plain. No emoji, no markdown, no quotation marks.',
  'If a hand-off finished, mention it by the expert’s name. Otherwise greet for the time of day and how long they were away.',
  'If the person’s name is given, you may greet them by it.',
  'Use only the facts given. Never invent facts: no tasks, files, results or plans that are not listed.',
].join('\n');

type DayPart = 'morning' | 'afternoon' | 'evening' | 'late night';

function dayPart(now: Date): DayPart {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late night';
}

/** Whole days away; 0 when under a day or unknown. */
function daysAway(context: GreetingContext): number {
  if (context.awaySince === null) return 0;
  return Math.floor((context.now.getTime() - context.awaySince.getTime()) / DAY_MS);
}

/** The handwritten line: the time of day or the days away, then what is waiting. */
export function fallbackGreeting(context: GreetingContext): string {
  const days = daysAway(context);
  const part = dayPart(context.now);
  const name = context.userName?.trim() ?? '';
  const named = name.length > 0 ? `, ${name}` : '';
  const opening =
    days >= 1
      ? `Back after ${days === 1 ? 'a day' : `${days} days`}${named}.`
      : part === 'late night'
        ? `Working late${named}?`
        : `${part[0]!.toUpperCase()}${part.slice(1)}${named}.`;
  const [first, ...rest] = context.handoffs;
  if (first === undefined) {
    return `${opening} ${days >= 1 ? 'Nothing waiting for you.' : 'I’m here when you need me.'}`;
  }
  if (rest.length === 0) return `${opening} ${first.expertName} finished what you handed over.`;
  return `${opening} ${context.handoffs.length} hand-offs finished while you were away.`;
}

/** The facts the model may use, and nothing else. */
function facts(context: GreetingContext): string {
  const time = context.now.toTimeString().slice(0, 5);
  const days = daysAway(context);
  const away =
    context.awaySince === null
      ? 'unknown'
      : days >= 1
        ? `${days} day${days === 1 ? '' : 's'}`
        : `${Math.max(0, Math.round((context.now.getTime() - context.awaySince.getTime()) / 3_600_000))} hours`;
  const handoffs =
    context.handoffs.length === 0
      ? ['none']
      : context.handoffs.map(
          (handoff) => `${handoff.expertName} finished: "${handoff.text.slice(0, BRIEF_CHARS)}"`,
        );
  const name = context.userName?.trim() ?? '';
  return [
    ...(name.length > 0 ? [`The person’s name: ${name}.`] : []),
    `Time of day: ${dayPart(context.now)} (${time}).`,
    `Time since the app last opened: ${away}.`,
    'Hand-offs finished since then:',
    ...handoffs.map((line) => `- ${line}`),
  ].join('\n');
}

/** The model's line made safe to show, or null when it is not one short plain sentence. */
function usable(raw: string): string | null {
  const line = (raw.trim().split('\n')[0] ?? '').trim().replace(/^["“'‘]+|["”'’]+$/g, '');
  if (line.length === 0 || line.length > MAX_CHARS) return null;
  if (line.split(/\s+/).length > MAX_WORDS) return null;
  if (/\p{Extended_Pictographic}/u.test(line)) return null;
  return line;
}

export async function composeGreeting(options: {
  pet: Pet;
  /** `settings.summarizer`: the summaries model, or null for the pet's own. */
  summarizer: Settings['summarizer'];
  /** The same resolver turns use. */
  provider: (pet: Pet) => BrainProvider;
  context: GreetingContext;
  timeoutMs?: number;
}): Promise<GreetingComposeResult> {
  const { pet, summarizer, context } = options;
  const fallback: GreetingComposeResult = { text: fallbackGreeting(context), source: 'fallback' };
  const { visionModel: _unused, ...textOnly } =
    summarizer === null ? pet : { ...pet, ...summarizer };
  const signal = AbortSignal.timeout(options.timeoutMs ?? GREETING_TIMEOUT_MS);
  // The budget holds even for a brain slow to notice the abort: the fallback goes out then.
  const outOfTime = new Promise<null>((resolve) =>
    signal.addEventListener('abort', () => resolve(null), { once: true }),
  );
  try {
    const asked = options.provider(textOnly).complete(
      {
        model: textOnly.model,
        system: GREETING_INSTRUCTIONS,
        messages: [{ role: 'user', content: [{ type: 'text', text: facts(context) }] }],
        maxTokens: GREETING_MAX_TOKENS,
      },
      {
        onText: () => undefined,
        onToolUse: () => Promise.resolve({ content: 'No tools here.', isError: true }),
      },
      signal,
    );
    asked.catch(() => undefined);
    const result = await Promise.race([asked, outOfTime]);
    const text = result?.stopReason === 'end' ? usable(result.text) : null;
    return text === null ? fallback : { text, source: 'model' };
  } catch {
    return fallback;
  }
}
