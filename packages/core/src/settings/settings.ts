import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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
 * Saves are atomic: the new text goes to a temp file that is renamed over the old
 * one, and the previous good file is kept as `settings.json.bak`. A corrupt or
 * schema-invalid file never stops boot: the store reads the `.bak` instead, then the
 * defaults, and logs why. The bad file stays on disk; the next save moves it to
 * `settings.json.corrupt` so a hand edit with a typo is never thrown away.
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
    const main = this.#load(this.#file);
    if (main.ok) return main.settings;
    console.warn(`[settings] ${main.problem}\nUsing the last good copy or the defaults.`);
    const backup = this.#load(`${this.#file}.bak`);
    return backup.ok ? backup.settings : Settings.parse({});
  }

  /** Merges a patch over the current values and persists the result. */
  set(patch: SettingsPatch): Settings {
    const parsedPatch = SettingsPatch.safeParse(patch);
    if (!parsedPatch.success) {
      throw new Error(`Invalid settings patch:\n${describeIssues(parsedPatch.error.issues)}`);
    }

    const merged = Settings.parse({ ...this.get(), ...parsedPatch.data });
    mkdirSync(this.#dataDir, { recursive: true });
    const temp = `${this.#file}.tmp`;
    writeFileSync(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
    const current = this.#load(this.#file);
    if (!current.ok) renameSync(this.#file, `${this.#file}.corrupt`);
    else if (current.exists) copyFileSync(this.#file, `${this.#file}.bak`);
    renameSync(temp, this.#file);
    return merged;
  }

  /** Reads and validates one settings file; a missing file reads as the defaults. */
  #load(
    file: string,
  ): { ok: true; settings: Settings; exists: boolean } | { ok: false; problem: string } {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ok: true, settings: Settings.parse({}), exists: false };
      }
      throw error;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      return { ok: false, problem: `${file} is not valid JSON: ${(error as Error).message}` };
    }

    const parsed = Settings.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        problem: `${file} does not match the settings schema:\n${describeIssues(parsed.error.issues)}`,
      };
    }
    return { ok: true, settings: parsed.data, exists: true };
  }
}
