/**
 * `meterBrain`: wraps a provider so every finished call is recorded (tokens only), in the
 * engine's single resolver.
 */
import type { BrainProvider } from '../providers/brain';

/** One finished model call, as the meter records it: counts only, never content. */
export interface MeteredCall {
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Wraps a provider so every call it finishes is recorded, aborted ones included (they
 * report what they used before stopping). A call that throws records nothing. Text and
 * tool calls pass through untouched.
 *
 * One wrapper at the single resolver, like `guardBrain`, so turns, check-ins, routines,
 * watches, the greeting and summaries are all metered and nothing new can skip it.
 */
export function meterBrain(
  provider: BrainProvider,
  record: (call: MeteredCall) => void,
): BrainProvider {
  const metered: BrainProvider = {
    id: provider.id,
    capabilities: provider.capabilities,
    complete: async (request, events, signal) => {
      const result = await provider.complete(request, events, signal);
      try {
        record({
          providerId: provider.id,
          model: request.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });
      } catch {
        // A meter that cannot write (the database closing at quit) never fails a turn.
      }
      return result;
    },
  };
  return metered;
}
