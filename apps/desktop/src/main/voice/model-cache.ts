import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Whether a model's file is already in the cache: a look on disk, never a fetch. */
export function isDownloaded(cacheDir: string, model: string, file: string): boolean {
  return existsSync(join(cacheDir, model, file));
}
