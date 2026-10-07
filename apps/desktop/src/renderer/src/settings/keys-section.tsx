import type { Settings } from '@tagalong/protocol';
import type { ProviderChoice } from '../../../shared/ipc';
import { Section } from './section';

/**
 * Provider keys and base URLs. A stored key is never read back into the form — `hasKey` is
 * all main will say — so a saved secret cannot be recovered from a window someone left open.
 */
export function KeysSection({
  providers,
  settings,
  keys,
  onKeysChange,
}: {
  providers: readonly ProviderChoice[];
  settings: Settings;
  keys: Record<string, string>;
  onKeysChange: (keys: Record<string, string>) => void;
}) {
  const keyed = providers.filter((choice) => choice.needsKey);
  const presets = providers.filter((choice) => choice.defaultBaseUrl !== undefined);
  return (
    <Section id="keys">
      {keyed.map((choice) => (
        <label key={choice.id}>
          <span>
            {choice.label} API key{choice.envVar === undefined ? '' : ` (${choice.envVar})`}{' '}
            {choice.hasKey ? '(one is stored — type to replace it)' : '(none stored)'}
          </span>
          <input
            type="password"
            name={`key:${choice.id}`}
            autoComplete="off"
            value={keys[choice.id] ?? ''}
            onChange={(event) => onKeysChange({ ...keys, [choice.id]: event.target.value })}
          />
        </label>
      ))}
      {presets.map((choice) => (
        <label key={choice.id}>
          <span>{choice.label} base URL (blank for the default)</span>
          <input
            name={`baseUrl:${choice.id}`}
            defaultValue={settings.providerBaseUrls[choice.id] ?? ''}
            placeholder={choice.defaultBaseUrl}
          />
        </label>
      ))}
      <p className="tg-note">
        Any OpenAI-compatible service works: point one of these at its base URL, store its key, and
        give the pet one of its model ids. Keys are encrypted with the OS keychain and never written
        in plain text.
      </p>
    </Section>
  );
}
