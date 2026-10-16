/**
 * Setup's key test. Contains `checkKey` (one tiny request on the provider's recommended
 * model) and `plainKeyProblem` (a failure as one plain sentence, never holding the key).
 * Called by the `providers.check` handler.
 */
import type { Pet, ProvidersCheckResult } from '@tagalong/protocol';
import { getRole, recommendedModel } from '../roles';
import { BrainError } from './index';
import type { BrainProvider } from './index';

/** Long enough for a cold service, short enough that setup never hangs on it. */
export const KEY_CHECK_TIMEOUT_MS = 15_000;

/** A failure as one plain sentence for setup; the key itself is never in it. */
export function plainKeyProblem(error: unknown, label: string): string {
  const code = error instanceof BrainError ? error.code : 'unknown';
  if (code === 'auth')
    return `${label} turned that key down. Check it was copied whole, or make a new one.`;
  if (code === 'connection')
    return `I couldn’t reach ${label}. Check your connection, then try again.`;
  if (code === 'rate_limit') return `${label} is busy right now. Try again in a moment.`;
  return `${label} didn’t take the test request. Try again, or pick another way to think.`;
}

/**
 * One real, tiny request on the provider's recommended model, so a pasted key is known to
 * work before Scout moves to it. Sixteen tokens at most: a fraction of a cent.
 */
export async function checkKey(options: {
  resolve: (pet: Pet) => BrainProvider;
  base: Pet;
  providerId: string;
  label: string;
  timeoutMs?: number;
}): Promise<ProvidersCheckResult> {
  const { base, providerId, label } = options;
  const companion = getRole('companion');
  const model =
    (companion === undefined ? undefined : recommendedModel(companion, providerId)?.model) ??
    base.model;
  const { visionModel: _vision, watchModel: _watch, ...rest } = base;
  const pet: Pet = { ...rest, providerId, model };
  try {
    const result = await options.resolve(pet).complete(
      {
        model,
        system: 'Reply with the word OK.',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'OK?' }] }],
        maxTokens: 16,
      },
      {
        onText: () => undefined,
        onToolUse: () => Promise.resolve({ content: 'No tools here.', isError: true }),
      },
      AbortSignal.timeout(options.timeoutMs ?? KEY_CHECK_TIMEOUT_MS),
    );
    return result.stopReason === 'aborted'
      ? { ok: false, message: `${label} didn’t answer in time. Try again in a moment.` }
      : { ok: true };
  } catch (error) {
    return { ok: false, message: plainKeyProblem(error, label) };
  }
}
