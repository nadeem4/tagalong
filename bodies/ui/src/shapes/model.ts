/**
 * What Settings reads of Scout's model choice: the provider, the model in use, the default and
 * the models to pick from. Contains parseModelState and ModelState, shaped after model_state
 * (brain/src/brain/tools.py).
 */
import { z } from 'zod';

const Wire = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  default: z.string().min(1),
  models: z.array(z.object({ id: z.string().min(1), name: z.string(), line: z.string() })).min(1),
});

export type ModelState = z.infer<typeof Wire>;

export function parseModelState(json: unknown): ModelState {
  return Wire.parse(json);
}
