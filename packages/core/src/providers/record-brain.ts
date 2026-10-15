import type { SightRecorder } from '../memory/sight-log';
import type { BrainContent, BrainContentBlock, BrainProvider, BrainRequest } from './brain';

/**
 * Wraps a provider so each `complete` writes one "Sent to AI" row to the log of what Scout
 * saw: the provider, the model, and how many characters and pictures went, the tool
 * results handed back mid-call included. Never the text or the pictures themselves.
 *
 * Composed in the engine's resolver next to `guardBrain`, so every call to a model — a
 * turn, a summary, a watch check, keep-an-eye, the launch line — is covered by
 * construction. The row is written when the call ends, failed or not: the request had
 * already left this computer.
 */
export function recordBrain(provider: BrainProvider, log: SightRecorder): BrainProvider {
  const recorded: BrainProvider = {
    id: provider.id,
    capabilities: provider.capabilities,
    listModels: () => provider.listModels(),
    complete: async (request, events, signal) => {
      const sent = measureRequest(request);
      try {
        return await provider.complete(
          request,
          {
            onText: (delta) => events.onText(delta),
            onToolUse: async (call) => {
              const result = await events.onToolUse(call);
              add(sent, measureContent(result.content));
              return result;
            },
          },
          signal,
        );
      } finally {
        try {
          log.record({
            kind: 'sent_to_ai',
            providerId: provider.id,
            model: request.model,
            chars: sent.chars,
            images: sent.images,
          });
        } catch (error) {
          console.warn('[sight-log] could not write a row:', error);
        }
      }
    },
  };
  if (provider.canSee !== undefined) {
    recorded.canSee = (model) => provider.canSee?.(model) ?? false;
  }
  return recorded;
}

interface Measure {
  chars: number;
  images: number;
}

function add(into: Measure, more: Measure): void {
  into.chars += more.chars;
  into.images += more.images;
}

function measureRequest(request: BrainRequest): Measure {
  const total: Measure = { chars: request.system.length, images: 0 };
  for (const message of request.messages) {
    for (const block of message.content) add(total, measureBlock(block));
  }
  return total;
}

function measureBlock(block: BrainContent): Measure {
  if (block.type === 'text') return { chars: block.text.length, images: 0 };
  if (block.type === 'image') return { chars: 0, images: 1 };
  if (block.type === 'tool_result') return measureContent(block.content);
  return { chars: 0, images: 0 };
}

function measureContent(content: string | BrainContentBlock[]): Measure {
  if (typeof content === 'string') return { chars: content.length, images: 0 };
  const total: Measure = { chars: 0, images: 0 };
  for (const block of content) add(total, measureBlock(block));
  return total;
}
