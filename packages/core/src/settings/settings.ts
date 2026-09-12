import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Settings, SettingsPatch } from '@tagalong/protocol';

/** The settings file a host finds next to the database in its data dir. */
export const SETTINGS_FILENAME = 'settings.json';

/**
 * Secrets never live in the settings file, so the engine never learns how they are
 * protected. The desktop host backs this with Electron safeStorage; tests use the
 * in-memory implementation below.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Volatile SecretStore for tests and for the fake-provider demo path. */
export class InMemorySecretStore implements SecretStore {
  readonly #secrets = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.#secrets.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.#secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.#secrets.delete(key);
  }
}

/** Renders zod issues as "field: problem" lines so an error points at what to fix. */
function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => `  ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/**
 * Settings as a JSON file in the host-supplied data dir.
 *
 * A corrupt or schema-invalid file is an error the user must see, never something to
 * paper over with defaults: silently resetting would throw away a hand-edited config
 * and hide the typo that caused it.
 */
export class SettingsStore {
  readonly #dataDir: string;
  readonly #file: string;

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
    this.#file = join(dataDir, SETTINGS_FILENAME);
  }

  /** Absolute path of the file this store reads and writes. */
  get file(): string {
    return this.#file;
  }

  /** Current settings, with every absent field filled in from the defaults. */
  get(): Settings {
    const text = this.#read();
    if (text === null) return Settings.parse({});

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Settings file ${this.#file} is not valid JSON: ${(error as Error).message}`,
        {
          cause: error,
        },
      );
    }

    const parsed = Settings.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Settings file ${this.#file} does not match the settings schema:\n` +
          describeIssues(parsed.error.issues),
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  /** Merges a patch over the current values and persists the result. */
  set(patch: SettingsPatch): Settings {
    const parsedPatch = SettingsPatch.safeParse(patch);
    if (!parsedPatch.success) {
      throw new Error(`Invalid settings patch:\n${describeIssues(parsedPatch.error.issues)}`);
    }

    const merged = Settings.parse({ ...this.get(), ...parsedPatch.data });
    mkdirSync(this.#dataDir, { recursive: true });
    writeFileSync(this.#file, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    return merged;
  }

  /** Returns the file text, or null when the file does not exist yet. */
  #read(): string | null {
    try {
      return readFileSync(this.#file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
