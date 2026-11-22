/**
 * The environment an e2e launch gets: the real one plus a temp TAGALONG_HOME holding the
 * local token the fake brain expects, so the desktop's hello is accepted.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E_LOCAL_TOKEN = 'e2e-local-token';

export function launchEnv(): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'tagalong-home-'));
  writeFileSync(join(home, 'local-token'), E2E_LOCAL_TOKEN);
  return { ...process.env, TAGALONG_HOME: home };
}
