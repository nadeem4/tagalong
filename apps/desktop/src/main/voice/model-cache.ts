import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Runs a model loader, and if it fails deletes that model's folder in the cache.
 * Transformers.js keeps whatever it downloaded under `cacheDir/<model id>`, so an
 * interrupted download would otherwise fail the same way on every later try; with the
 * folder gone the next try downloads the model again.
 */
export async function loadOrForget<T>(
  cacheDir: string,
  model: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await load();
  } catch (error) {
    await rm(join(cacheDir, model), { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
