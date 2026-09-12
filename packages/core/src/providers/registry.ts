import type { BrainProvider } from './brain';
import { AnthropicProvider } from './anthropic';
import { FakeBrainProvider } from './fake';
import { BrainError } from './errors';

/** What the engine knows about the provider before it builds one. */
export interface ProviderConfig {
  /** Matches `Settings.providerId`. Phase 1 ships 'anthropic' and 'fake'. */
  providerId: string;
  /** Read from the host's SecretStore; never stored in settings. */
  apiKey?: string | undefined;
  /** Injected so tests can set TAGALONG_FAKE_PROVIDERS without touching the process. */
  env?: Record<string, string | undefined> | undefined;
}

/** The line the fake provider reads when nothing scripted it. */
const FAKE_SCRIPT = 'This is the fake pet. I stream scripted text so tests never call the network.';

export function createProvider(config: ProviderConfig): BrainProvider {
  const env = config.env ?? process.env;

  // The escape hatch every UI and end-to-end test relies on: whatever settings say,
  // this flag means no request ever leaves the machine.
  if (env.TAGALONG_FAKE_PROVIDERS === '1') {
    return new FakeBrainProvider({ text: FAKE_SCRIPT });
  }

  switch (config.providerId) {
    case 'fake':
      return new FakeBrainProvider({ text: FAKE_SCRIPT });
    case 'anthropic':
      if (!config.apiKey) {
        throw new BrainError('auth', 'No Anthropic API key is stored. Add one in Settings.');
      }
      return new AnthropicProvider({ apiKey: config.apiKey });
    default:
      throw new BrainError(
        'config',
        `Unknown provider id '${config.providerId}'. Phase 1 supports 'anthropic' and 'fake'.`,
      );
  }
}
