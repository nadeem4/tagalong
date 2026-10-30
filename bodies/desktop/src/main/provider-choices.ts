/**
 * The brains Settings offers, built from core's presets, and where each key lives in the
 * keychain. Contains providerChoices, storedKeys, secretKeyFor, forgetRetiredKeys and
 * ELEVENLABS_SECRET_KEY.
 */

import { OPENAI_COMPATIBLE_PRESETS, SECRET_KEYS, type SecretStore } from '@tagalong/core';
import type { ProviderChoice } from '../shared/ipc';

/** Presets in the order a person meets them. */
const PRESET_ORDER = ['openrouter'] as const;

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

/** The providers with a key stored. Only the fact crosses on; the key never does. */
export async function storedKeys(secrets: {
  get(key: string): Promise<string | null>;
}): Promise<Set<string>> {
  const stored = new Set<string>();
  for (const choice of providerChoices(new Set())) {
    const secretKey = secretKeyFor(choice.id);
    if (secretKey === undefined) continue;
    const value = await secrets.get(secretKey);
    if (value !== null && value.length > 0) stored.add(choice.id);
  }
  return stored;
}

/**
 * Where the ElevenLabs key is kept. It is the voice's key, not a brain's, so it lives here
 * rather than in core's SECRET_KEYS: the engine never reads it.
 */
export const ELEVENLABS_SECRET_KEY = 'elevenlabs.apiKey';

/** Keys for providers Tagalong no longer has. Deleted at boot so none lingers on disk. */
const RETIRED_SECRET_KEYS = ['nebius.apiKey'] as const;

/**
 * Deletes the keys of retired providers. It writes only when one is there: a delete rewrites
 * the whole store, so doing it on every boot would put every stored key at risk for nothing.
 * A key the store cannot read stays; nothing reads it either.
 */
export async function forgetRetiredKeys(secrets: SecretStore): Promise<void> {
  for (const key of RETIRED_SECRET_KEYS) {
    if ((await secrets.get(key).catch(() => null)) !== null) await secrets.delete(key);
  }
}

/** Whether a provider id has a keychain entry at all, so a renderer cannot invent one. */
export function secretKeyFor(providerId: string): string | undefined {
  if (providerId === 'elevenlabs') return ELEVENLABS_SECRET_KEY;
  return Object.hasOwn(SECRET_KEYS, providerId) ? SECRET_KEYS[providerId] : undefined;
}
