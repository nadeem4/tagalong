/**
 * `guardBrain`: wraps a provider so no secret reaches a model. Applied once in the
 * engine's resolver, so a new text source cannot forget it.
 */
import { hideSecrets } from '../privacy/secrets';
import type { BrainContent, BrainContentBlock, BrainProvider, BrainRequest } from './brain';

/**
 * Wraps a provider so no secret reaches the model: every piece of text in the request, and
 * every tool result handed back mid-turn, passes through `hideSecrets` first.
 *
 * One wrapper at the provider rather than a call at each source, because the sources keep
 * growing (selection, window text, the clipboard, memories, page text) and a new one must
 * not be able to forget. Tool results need their own pass: providers send them back inside
 * `complete`, after the request has left this wrapper.
 */
export function guardBrain(provider: BrainProvider): BrainProvider {
  const guarded: BrainProvider = {
    id: provider.id,
    capabilities: provider.capabilities,
    listModels: () => provider.listModels(),
    complete: (request, events, signal) =>
      provider.complete(
        guardRequest(request),
        {
          onText: (delta) => events.onText(delta),
          onToolUse: async (call) => {
            const result = await events.onToolUse(call);
            return { ...result, content: guardContent(result.content) };
          },
        },
        signal,
      ),
  };
  if (provider.canSee !== undefined) guarded.canSee = (model) => provider.canSee?.(model) ?? false;
  return guarded;
}

function guardRequest(request: BrainRequest): BrainRequest {
  return {
    ...request,
    system: hideSecrets(request.system),
    messages: request.messages.map((message) => ({
      ...message,
      content: message.content.map(guardBlock),
    })),
  };
}

function guardBlock(block: BrainContent): BrainContent {
  if (block.type === 'text') return { ...block, text: hideSecrets(block.text) };
  if (block.type === 'tool_result') return { ...block, content: guardContent(block.content) };
  return block;
}

function guardContent(content: string | BrainContentBlock[]): string | BrainContentBlock[] {
  if (typeof content === 'string') return hideSecrets(content);
  return content.map((part) =>
    part.type === 'text' ? { ...part, text: hideSecrets(part.text) } : part,
  );
}
