import { join } from 'node:path';
import type { EarsParts } from './local-ears';
import { EARS_FILES, ensureFiles } from './model-files';
import { loadOrtParts } from './ort-ears';
import { loadSmartTurn } from './smart-turn';

/** Downloads what is missing, then loads all three parts. Voice process only. */
export async function loadEars(dir: string): Promise<EarsParts> {
  await ensureFiles(dir, EARS_FILES);
  const [heard, turn] = await Promise.all([
    loadOrtParts(dir),
    loadSmartTurn(join(dir, 'ears/smart-turn-v3/smart-turn-v3.2-cpu.onnx')),
  ]);
  return { ...heard, turn };
}
