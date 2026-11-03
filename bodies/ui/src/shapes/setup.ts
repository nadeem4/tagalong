/**
 * What the Connections page and the tour read of the brain's setup: installed experts and apps
 * with a state, what could be added, and a running install's progress. Contains
 * parseSetupOverview and the SetupOverview types, shaped after the brain's setup_overview
 * (brain/src/brain/setup/home_tools.py).
 */
import { z } from 'zod';

const ExpertState = z.enum(['ready', 'needs_login', 'needs_update']);
const Choice = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  description: z.string(),
});

const Wire = z
  .object({
    experts: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        version: z.string(),
        state: ExpertState,
        tested: z.boolean(),
      }),
    ),
    apps: z.array(z.object({ id: z.string().min(1), name: z.string(), state: z.string() })),
    browse_experts: z.array(Choice),
    browse_apps: z.array(Choice),
    stale: z.boolean(),
    progress: z
      .object({
        expert: z.string().optional(),
        stage: z.string(),
        percent: z.number().optional(),
      })
      .nullable(),
    failed: z.object({ expert: z.string(), error: z.string() }).nullable(),
  })
  .transform(({ browse_experts, browse_apps, ...rest }) => ({
    ...rest,
    browseExperts: browse_experts,
    browseApps: browse_apps,
  }));

export type SetupOverview = z.infer<typeof Wire>;
export type SetupExpert = SetupOverview['experts'][number];
export type SetupChoice = z.infer<typeof Choice>;

export function parseSetupOverview(json: unknown): SetupOverview {
  return Wire.parse(json);
}

/** What setting something up answers at once; `error` is a short token such as `denied`. */
export interface SetupResult {
  error?: string;
  /** A login's answer: `waiting` (a window or browser opened) or `logged_in` (nothing to do). */
  state?: string;
}
