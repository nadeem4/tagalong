/**
 * Picks the model that answers a turn when it carries a picture. Contains `modelForTurn`
 * and `carriesImage`.
 */
import type { BrainMessage, BrainProvider } from './brain';

/**
 * Which of a pet's models answers this turn, or null when none of them can see it.
 *
 * The pet's text model answers when it can see; otherwise a turn with a picture (a
 * screenshot with the question, or an image a tool such as `look_closer` hands back
 * mid-turn) moves to the pet's vision model. So a pet on a vision model never pays for a
 * switch it does not need.
 *
 * Whether a model can see comes from the provider, never from the model's name: a
 * provider with `capabilities.vision === false` sees nothing, and one without `canSee`
 * sees with every model (Anthropic's all do). A vision model the pet names is trusted
 * even when the provider does not list it: the person chose it on purpose, and the live
 * model list can know models this build does not.
 *
 * Null is the instruction to drop the pixels. Sending them anyway would buy a confident
 * answer about an image nobody read.
 */
export function modelForTurn(
  provider: BrainProvider,
  pet: { model: string; visionModel?: string | undefined },
  withImage: boolean,
): string | null {
  if (!withImage) return pet.model;
  if (!provider.capabilities.vision) return null;
  if (provider.canSee === undefined || provider.canSee(pet.model)) return pet.model;
  return pet.visionModel ?? null;
}

/** Whether any message, or any tool result inside one, holds an image. */
export function carriesImage(messages: readonly BrainMessage[]): boolean {
  return messages.some((message) =>
    message.content.some((block) => {
      if (block.type === 'image') return true;
      if (block.type !== 'tool_result' || typeof block.content === 'string') return false;
      return block.content.some((part) => part.type === 'image');
    }),
  );
}
