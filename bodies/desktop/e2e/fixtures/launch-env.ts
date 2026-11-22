/**
 * The environment an e2e launch gets: the real one plus TAGALONG_HOME pointing at the spec's
 * own data dir, which holds the local token the fake brain expects so the desktop's hello is
 * accepted.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const E2E_LOCAL_TOKEN = 'e2e-local-token';

export function launchEnv(dataDir: string): NodeJS.ProcessEnv {
  writeFileSync(join(dataDir, 'local-token'), E2E_LOCAL_TOKEN);
  return { ...process.env, TAGALONG_HOME: dataDir };
}
