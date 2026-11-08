/**
 * The ask desk: pure bookkeeping for the permission asks shown on the phone. It decides how an
 * open ask is worded (reply buttons or a numbered list) and which ask a tap or a typed text
 * answers. It never talks to the network; the bridge does the sending.
 */
import type { AskParams } from '@tagalong/contract';

export type OpenAsk = Extract<AskParams, { state: 'open' }>;

export type Outgoing =
  | { kind: 'buttons'; body: string; buttons: { id: string; title: string }[] }
  | { kind: 'text'; body: string };

export type Answer = { ask: string; option: string; text?: string };

// Reply-button limits: verify at build against Meta's docs (3 buttons, 20-character titles).
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
export const MAX_BUTTON_BODY = 1024;

const BUTTON_ID = /^ask:(.+):(\d+)$/;
// "yes" and "no" stand for the confirm options when the ask has them.
const SYNONYMS: Record<string, string> = { yes: 'allow', no: 'deny' };

export class AskDesk {
  // Insertion order. `epoch` counts the replies sent to the phone before the ask was shown: a
  // typed text may answer only an ask that no reply has come after.
  private readonly asks = new Map<string, { ask: OpenAsk; epoch: number }>();

  /** The message to send for a newly open ask, or null when it is already on the phone. */
  open(ask: OpenAsk, epoch = 0): Outgoing | null {
    if (this.asks.has(ask.id)) return null;
    this.asks.set(ask.id, { ask, epoch });
    const said = ask.text.trim();
    // An empty text still has to say what is asked; the contract gives the tool and input.
    const text =
      said ||
      `Scout wants to use ${ask.tool ?? 'a tool'}${
        ask.input === undefined ? '' : ` with ${JSON.stringify(ask.input)}`
      }`;
    const titles = ask.options.map((o) => o.toLowerCase());
    const fitsButtons =
      !ask.free_text &&
      said.length > 0 &&
      ask.text.length <= MAX_BUTTON_BODY &&
      ask.options.length >= 1 &&
      ask.options.length <= MAX_BUTTONS &&
      ask.options.every((o) => o.length <= MAX_BUTTON_TITLE) &&
      new Set(titles).size === titles.length;
    if (fitsButtons) {
      return {
        kind: 'buttons',
        body: ask.text,
        buttons: ask.options.map((title, i) => ({ id: `ask:${ask.id}:${i}`, title })),
      };
    }
    const list = ask.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const tail = ask.free_text ? '\n\nType your reply: it is the answer.' : '';
    return { kind: 'text', body: `${text}\n\n${list}${tail}` };
  }

  close(id: string): void {
    this.asks.delete(id);
  }

  clear(): void {
    this.asks.clear();
  }

  ids(): string[] {
    return [...this.asks.keys()];
  }

  fromButton(buttonId: string): Answer | { closed: true } {
    const m = BUTTON_ID.exec(buttonId);
    const held = m?.[1] === undefined ? undefined : this.asks.get(m[1]);
    const option = held?.ask.options[Number(m?.[2])];
    return held && option !== undefined ? { ask: held.ask.id, option } : { closed: true };
  }

  /**
   * null means the text is not an answer (the bridge treats it as a normal say). Only asks
   * shown at `epoch`, with no reply sent since, can be answered by typing.
   */
  fromText(text: string, epoch = 0): Answer | { ambiguous: true } | null {
    const said = text.trim();
    if (!said) return null;
    const answers = [...this.asks.values()]
      .filter((h) => h.epoch === epoch)
      .map((h) => match(h.ask, said))
      .filter((a): a is Answer => a !== null);
    const live = [...this.asks.values()].filter((h) => h.epoch === epoch).length;
    if (live > 1) return answers.length > 0 ? { ambiguous: true } : null;
    return answers[0] ?? null;
  }
}

function match(ask: OpenAsk, said: string): Answer | null {
  if (ask.free_text) return { ask: ask.id, option: ask.options[0] ?? '', text: said };
  const word = said.toLowerCase();
  const wanted = SYNONYMS[word] ?? word;
  const byNumber = /^\d+$/.test(word) ? ask.options[Number(word) - 1] : undefined;
  const option = byNumber ?? ask.options.find((o) => o.toLowerCase() === wanted);
  return option === undefined ? null : { ask: ask.id, option };
}
