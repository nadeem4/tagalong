/** Whether a model file is already on disk: a look, never a fetch. Contains isDownloaded. */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function isDownloaded(cacheDir: string, model: string, file: string): boolean {
  return existsSync(join(cacheDir, model, file));
}
