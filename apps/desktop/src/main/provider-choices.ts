import { OPENAI_COMPATIBLE_PRESETS, SECRET_KEYS } from '@tagalong/core';
import type { ProviderChoice } from '../shared/ipc';

/** Presets in the order a person meets them: OpenRouter to try things, Token Factory to ship. */
const PRESET_ORDER = ['openrouter', 'nebius'] as const;

/**
 * The providers the settings window offers, built from core's presets so the form can
 * never list a service the engine cannot build.
 *
 * `stored` names the providers with a key in the keychain. Only that fact crosses to
 * the renderer; the key itself never does.
 */
export function providerChoices(stored: ReadonlySet<string>): ProviderChoice[] {
  const presets = PRESET_ORDER.flatMap((id) => {
    const preset = OPENAI_COMPATIBLE_PRESETS[id];
    if (preset === undefined) return [];
    return [
      {
        id,
        label: preset.label,
        defaultBaseUrl: preset.baseURL,
        envVar: preset.envVar,
        needsKey: true,
        hasKey: stored.has(id),
      },
    ];
  });
  return [
    // First, because it needs nothing: it thinks through the person's own Claude Code sign-in.
    {
      id: 'claude-code',
      label: 'Your Claude sign-in',
      needsKey: false,
      hasKey: false,
    },
    ...presets,
    { id: 'anthropic', label: 'Anthropic', needsKey: true, hasKey: stored.has('anthropic') },
    { id: 'fake', label: 'Fake (offline demo)', needsKey: false, hasKey: false },
  ];
}

/** Whether a provider id has a keychain entry at all, so a renderer cannot invent one. */
export function secretKeyFor(providerId: string): string | undefined {
  return Object.hasOwn(SECRET_KEYS, providerId) ? SECRET_KEYS[providerId] : undefined;
}
