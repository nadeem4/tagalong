/**
 * Seeds a fresh user-data directory's settings.json for an e2e launch. The walkthrough is
 * marked done so no suite meets the first-run tour; a suite passes `patch` for anything else.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function seedSettings(dataDir: string, patch: Record<string, unknown> = {}): string {
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({ walkthrough: { done: true }, ...patch }),
    'utf8',
  );
  return dataDir;
}
