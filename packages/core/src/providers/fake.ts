/**
 * The scripted provider behind `TAGALONG_FAKE_PROVIDERS=1`. Contains `FakeBrainProvider`,
 * `FakeScript` and `FAKE_MODELS`. Streams word by word, can call one tool first and
 * honours interruption, so UI and end-to-end tests run the real streaming paths with no
 * network.
 */
import type {
  BrainCapabilities,
  BrainEvents,
  BrainProvider,
  BrainRequest,
  BrainResult,
} from './brain';

/** What the fake pet will say, and whether it reaches for a tool first. */
export interface FakeScript {
  text: string;
  toolCall?: { id: string; name: string; input: unknown };
  /** Milliseconds between words. Zero by default, which keeps tests fast. */
  delayMs?: number;
}

/** Rough characters-per-token ratio, good enough for a plausible-looking usage report. */
const CHARS_PER_TOKEN = 4;

export const FAKE_MODELS: readonly string[] = ['fake-model'];

function countTokens(chars: number): number {
  return Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
}

function promptLength(req: BrainRequest): number {
  const body = req.messages
    .flatMap((message) => message.content)
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'tool_result':
          // A block-carrying result is billed for its pixels too, so count the base64.
          return typeof block.content === 'string'
            ? block.content
            : block.content
                .map((part) => (part.type === 'text' ? part.text : part.base64))
                .join('');
        case 'tool_use':
          return JSON.stringify(block.input);
        case 'image':
          return block.base64;
      }
    })
    .join('');
  return req.system.length + body.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Scripted provider behind `TAGALONG_FAKE_PROVIDERS=1`.
 *
 * It exists so UI and end-to-end tests exercise the real streaming code paths —
 * word-by-word deltas, a tool round trip, and interruption — without a network call.
 */
export class FakeBrainProvider implements BrainProvider {
  readonly id = 'fake';
  readonly capabilities: BrainCapabilities = { vision: true, tools: true, streaming: true };

  constructor(private readonly script: FakeScript) {}

  listModels(): Promise<string[]> {
    return Promise.resolve([...FAKE_MODELS]);
  }

  async complete(
    req: BrainRequest,
    events: BrainEvents,
    signal: AbortSignal,
  ): Promise<BrainResult> {
    const inputTokens = countTokens(promptLength(req));
    const delayMs = this.script.delayMs ?? 0;

    if (signal.aborted) {
      return { text: '', stopReason: 'aborted', usage: { inputTokens, outputTokens: 0 } };
    }

    if (this.script.toolCall) {
      // Await the result the way a real provider does: the runner's tool executor
      // must finish before the answer that depends on it starts streaming.
      await events.onToolUse(this.script.toolCall);
    }

    const words = this.script.text.split(' ');
    let text = '';
    const finish = (stopReason: BrainResult['stopReason']): BrainResult => ({
      text,
      stopReason,
      usage: { inputTokens, outputTokens: countTokens(text.length) },
    });

    for (const [index, word] of words.entries()) {
      if (signal.aborted) return finish('aborted');
      const delta = index === 0 ? word : ` ${word}`;
      text += delta;
      events.onText(delta);
      await sleep(delayMs);
    }

    return finish(signal.aborted ? 'aborted' : 'end');
  }
}
