/**
 * Folds long conversations into summary memories after a turn, off the request path
 * (Summarizer).
 */
import type { Message, Pet } from '@tagalong/protocol';
import type { BrainProvider } from '../providers';
import type { SettingsStore } from '../settings/settings';
import type { MemoryStore } from './memories';
import type { ConversationStore } from './store';

/** A conversation is summarised once this many messages have built up unsummarised. */
export const SUMMARY_THRESHOLD = 20;

/** The newest messages a summary leaves alone, so the next turn still reads naturally. */
export const SUMMARY_KEEP_RECENT = 4;

/** Long enough for a dense paragraph, short enough to sit in recall beside other notes. */
export const MAX_SUMMARY_CHARS = 1000;

const SUMMARY_MAX_TOKENS = 400;

/** A summary is housekeeping: if the brain has not answered in a minute, try next turn. */
export const SUMMARY_TIMEOUT_MS = 60_000;

const SUMMARY_INSTRUCTIONS = [
  'You condense a conversation between a user and an assistant into a memory note.',
  'Write one paragraph of plain prose, at most 120 words.',
  'Keep what will matter later: what the user was working on, decisions made, preferences the user stated, open questions.',
  'Drop greetings, filler, and anything that was only on screen for a moment.',
  'Do not address the user. Do not use markdown.',
].join('\n');

export interface SummarizerOptions {
  store: ConversationStore;
  memories: MemoryStore;
  /** Read per job, so choosing a summarizer model in Settings applies to the next one. */
  settings: SettingsStore;
  /** The same resolver turns use, handed a pet whose provider and model are the summarizer's. */
  provider: (pet: Pet) => BrainProvider;
  /** Where a failed job is reported. The job itself never throws. */
  onError?: (error: unknown) => void;
  timeoutMs?: number;
}

/**
 * Folds long conversations into summary memories, off the request path.
 *
 * After a turn the runner hands the conversation here and moves on. Once twenty messages
 * have built up unsummarised, everything but the newest four goes to a brain with a short
 * instruction; the reply becomes a `summary` memory for the pet and those messages are
 * marked summarised, so the history replayed to the model shrinks while recall carries the
 * gist. A failure changes nothing and the next turn tries again.
 */
export class Summarizer {
  readonly #options: SummarizerOptions;
  readonly #running = new Map<string, Promise<boolean>>();

  constructor(options: SummarizerOptions) {
    this.#options = options;
  }

  /** Resolves true when a summary was written. Concurrent calls share one job. */
  schedule(conversationId: string, pet: Pet): Promise<boolean> {
    const running = this.#running.get(conversationId);
    if (running !== undefined) return running;
    const job = this.#run(conversationId, pet).finally(() => {
      this.#running.delete(conversationId);
    });
    this.#running.set(conversationId, job);
    return job;
  }

  async #run(conversationId: string, pet: Pet): Promise<boolean> {
    const pending = this.#options.store.unsummarizedMessages(conversationId);
    if (pending.length < SUMMARY_THRESHOLD) return false;
    const folding = pending.slice(0, pending.length - SUMMARY_KEEP_RECENT);

    const chosen = this.#options.settings.get().summarizer;
    const brainPet: Pet = chosen === null ? pet : { ...pet, ...chosen };

    try {
      const provider = this.#options.provider(brainPet);
      const result = await provider.complete(
        {
          model: brainPet.model,
          system: SUMMARY_INSTRUCTIONS,
          messages: [{ role: 'user', content: [{ type: 'text', text: transcript(folding, pet) }] }],
          maxTokens: SUMMARY_MAX_TOKENS,
        },
        {
          onText: () => undefined,
          onToolUse: () => Promise.resolve({ content: 'No tools here.', isError: true }),
        },
        AbortSignal.timeout(this.#options.timeoutMs ?? SUMMARY_TIMEOUT_MS),
      );
      const text = result.text.trim().slice(0, MAX_SUMMARY_CHARS);
      if (text.length === 0 || result.stopReason !== 'end') {
        throw new Error(`the summary came back ${result.stopReason} with ${text.length} chars`);
      }
      this.#options.memories.add({ scope: 'pet', petId: pet.id, kind: 'summary', text });
      this.#options.store.markSummarized(folding.map((message) => message.id));
      return true;
    } catch (error) {
      this.#options.onError?.(error);
      return false;
    }
  }
}

/** "User: …" and "Scout: …" lines, text only: pictures and tool traffic do not summarise. */
function transcript(messages: readonly Message[], pet: Pet): string {
  return messages
    .map((message) => {
      const text = message.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join(' ')
        .trim();
      return text.length === 0 ? '' : `${message.role === 'user' ? 'User' : pet.name}: ${text}`;
    })
    .filter((line) => line.length > 0)
    .join('\n');
}
