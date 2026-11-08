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

const BUTTON_ID = /^ask:(.+):(\d+)$/;
// "yes" and "no" stand for the confirm options when the ask has them.
const SYNONYMS: Record<string, string> = { yes: 'allow', no: 'deny' };

export class AskDesk {
  // Insertion order: the newest ask is the last.
  private readonly asks = new Map<string, OpenAsk>();

  /** The message to send for a newly open ask, or null when it is already on the phone. */
  open(ask: OpenAsk): Outgoing | null {
    if (this.asks.has(ask.id)) return null;
    this.asks.set(ask.id, ask);
    const fitsButtons =
      !ask.free_text &&
      ask.options.length >= 1 &&
      ask.options.length <= MAX_BUTTONS &&
      ask.options.every((o) => o.length <= MAX_BUTTON_TITLE);
    if (fitsButtons) {
      return {
        kind: 'buttons',
        body: ask.text,
        buttons: ask.options.map((title, i) => ({ id: `ask:${ask.id}:${i}`, title })),
      };
    }
    const list = ask.options.map((o, i) => `${i + 1}. ${o}`).join('\n');
    const tail = ask.free_text ? '\n\nType your reply, or send a number.' : '';
    return { kind: 'text', body: `${ask.text}\n\n${list}${tail}` };
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
    const ask = m?.[1] === undefined ? undefined : this.asks.get(m[1]);
    const option = ask?.options[Number(m?.[2])];
    return ask && option !== undefined ? { ask: ask.id, option } : { closed: true };
  }

  /** null means the text is not an answer (the bridge treats it as a normal say). */
  fromText(text: string): Answer | { ambiguous: true } | null {
    if (this.asks.size === 0) return null;
    if (this.asks.size > 1) return { ambiguous: true };
    const ask = [...this.asks.values()][0] as OpenAsk;
    const said = text.trim();
    if (!said) return null;
    if (ask.free_text) return { ask: ask.id, option: ask.options[0] ?? '', text: said };
    const word = said.toLowerCase();
    const wanted = SYNONYMS[word] ?? word;
    const byNumber = /^\d+$/.test(word) ? ask.options[Number(word) - 1] : undefined;
    const option = byNumber ?? ask.options.find((o) => o.toLowerCase() === wanted);
    return option === undefined ? null : { ask: ask.id, option };
  }
}
