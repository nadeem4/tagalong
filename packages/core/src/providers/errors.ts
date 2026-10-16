/**
 * `BrainError`: a provider failure with a code (`rate_limit`, `auth`, `connection`,
 * `config`, `unknown`) the runner turns into `turn.error` without inspecting SDK internals.
 * The code drives host behaviour (retry, prompt for a key, go offline); the message is
 * written for the person.
 */
export type BrainErrorCode = 'rate_limit' | 'auth' | 'connection' | 'config' | 'unknown';

export class BrainError extends Error {
  readonly code: BrainErrorCode;

  constructor(code: BrainErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BrainError';
    this.code = code;
  }
}
