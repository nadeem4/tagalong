import type { BrainProvider } from './brain';
import { AnthropicProvider } from './anthropic';
import { FakeBrainProvider } from './fake';
import { BrainError } from './errors';
import { OpenAiCompatibleProvider } from './openai-compatible';
import { openAiPreset } from './presets';

/** What the engine knows about the provider before it builds one. */
export interface ProviderConfig {
  /** Matches `Pet.providerId`: 'anthropic', 'nebius', 'openrouter' or 'fake'. */
  providerId: string;
  /** Read from the host's SecretStore; never stored in settings. */
  apiKey?: string | undefined;
  /** From `Settings.providerBaseUrls`; absent means the preset's own URL. */
  baseURL?: string | undefined;
  /** Injected so tests can set TAGALONG_FAKE_PROVIDERS without touching the process. */
  env?: Record<string, string | undefined> | undefined;
}

/** The line the fake provider reads when nothing scripted it. */
const FAKE_SCRIPT = 'This is the fake pet. I stream scripted text so tests never call the network.';

/**
 * Lets a test script the fake pet to reach for one tool before it answers.
 *
 * It exists for the end-to-end smoke test. Tool tests hand the toolset a fake host and
 * host tests feed fixture output, so the `perception.*` methods on the socket between
 * them are covered by neither — and this phase has shipped two dead paths through that
 * gap. Driving a real tool call through a real host needs a provider that will call one,
 * and no test may spend the user's tokens on a real model to get it.
 *
 * Malformed input degrades to no input rather than throwing: the variable is typed by
 * hand in a test script, and a typo should not take down the app under test.
 */
function fakeScriptFrom(env: Record<string, string | undefined>): {
  text: string;
  toolCall?: { id: string; name: string; input: unknown };
} {
  const name = env.TAGALONG_FAKE_TOOL;
  if (name === undefined || name.length === 0) return { text: FAKE_SCRIPT };

  let input: unknown;
  try {
    const raw = env.TAGALONG_FAKE_TOOL_INPUT;
    input = raw === undefined || raw.length === 0 ? undefined : JSON.parse(raw);
  } catch {
    input = undefined;
  }
  return { text: FAKE_SCRIPT, toolCall: { id: 'fake-tool-1', name, input } };
}

export function createProvider(config: ProviderConfig): BrainProvider {
  const env = config.env ?? process.env;

  // The escape hatch every UI and end-to-end test relies on: whatever settings say,
  // this flag means no request ever leaves the machine.
  if (env.TAGALONG_FAKE_PROVIDERS === '1') {
    return new FakeBrainProvider(fakeScriptFrom(env));
  }

  const preset = openAiPreset(config.providerId);
  if (preset !== undefined) {
    if (!config.apiKey) {
      throw new BrainError('auth', `No ${preset.label} API key is stored. Add one in Settings.`);
    }
    return new OpenAiCompatibleProvider({
      id: preset.id,
      apiKey: config.apiKey,
      baseURL: config.baseURL ?? preset.baseURL,
      label: preset.label,
      models: preset.fallbackModels,
      visionModels: preset.visionModels,
    });
  }

  switch (config.providerId) {
    case 'fake':
      return new FakeBrainProvider(fakeScriptFrom(env));
    case 'anthropic':
      if (!config.apiKey) {
        throw new BrainError('auth', 'No Anthropic API key is stored. Add one in Settings.');
      }
      return new AnthropicProvider({ apiKey: config.apiKey });
    default:
      throw new BrainError(
        'config',
        `Unknown provider id '${config.providerId}'. Supported: 'nebius', 'openrouter', 'anthropic' and 'fake'.`,
      );
  }
}
