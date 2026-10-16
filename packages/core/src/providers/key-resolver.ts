/**
 * `KeyedProviderResolver`: builds each pet's provider from the keychain the first time a
 * turn needs it, and rebuilds it only when its key or base URL changes. The engine calls
 * `refresh` before every ask.
 */
import type { Pet } from '@tagalong/protocol';
import type { SecretStore } from '../settings/settings';
import type { BrainProvider } from './brain';
import { SECRET_KEYS } from './presets';
import { createProvider } from './registry';

export interface KeyedProviderResolverOptions {
  secrets: SecretStore;
  /** The base URL override for a provider, read whenever a provider is resolved. */
  baseUrl: (providerId: string) => string | undefined;
  env?: Record<string, string | undefined> | undefined;
}

/** A built provider and the key and URL it was built with, so a change is noticed. */
interface Built {
  provider: BrainProvider;
  apiKey: string | undefined;
  baseURL: string | undefined;
}

/**
 * Builds each pet's provider the first time a turn needs it, then reuses it.
 *
 * Keys are read by `refresh`, which the engine calls before every ask. That lets a key
 * pasted in Welcome or Settings answer the very next question without a restart. Reading
 * the keychain per ask is cheap; the provider is rebuilt only when its key or base URL
 * changed.
 *
 * A provider that cannot be built (no key, an unknown id) is not cached, so the error is
 * raised on the turn that hit it and reported as that turn's `turn.error` rather than
 * failing boot for every pet.
 */
export class KeyedProviderResolver {
  readonly #options: KeyedProviderResolverOptions;
  readonly #keys = new Map<string, string>();
  readonly #built = new Map<string, Built>();

  constructor(options: KeyedProviderResolverOptions) {
    this.#options = options;
  }

  /** Re-reads every provider key from the secret store. */
  async refresh(): Promise<void> {
    for (const [providerId, secretKey] of Object.entries(SECRET_KEYS)) {
      const value = await this.#options.secrets.get(secretKey);
      if (value !== null && value.length > 0) this.#keys.set(providerId, value);
      else this.#keys.delete(providerId);
    }
  }

  /** The provider for a pet, built now if its key or base URL changed since last time. */
  resolve(pet: Pet): BrainProvider {
    const apiKey = this.#keys.get(pet.providerId);
    const baseURL = this.#options.baseUrl(pet.providerId);
    const cached = this.#built.get(pet.providerId);
    if (cached !== undefined && cached.apiKey === apiKey && cached.baseURL === baseURL) {
      return cached.provider;
    }
    const provider = createProvider({
      providerId: pet.providerId,
      apiKey,
      baseURL,
      env: this.#options.env,
    });
    this.#built.set(pet.providerId, { provider, apiKey, baseURL });
    return provider;
  }
}
