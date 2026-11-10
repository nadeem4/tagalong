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
  // Old brains do not send it; an expert row is Official only when the brain says so.
  official: z.boolean().default(false),
});

const AppRowWire = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  official: z.boolean(),
  publisher: z.string(),
  runs: z.enum(['pc', 'hosted']).nullable(),
  host: z.string().nullable(),
  sign_in: z.enum(['browser', 'key', 'none']),
  licence: z.string(),
  repo: z.string(),
  why: z.string().optional(),
});
const toAppRow = ({ sign_in, ...rest }: z.infer<typeof AppRowWire>) => ({
  ...rest,
  signIn: sign_in,
});
const AppRow = AppRowWire.transform(toAppRow);
const RegistrySource = z.object({ name: z.string(), url: z.string() });

const Wire = z
  .object({
    experts: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        version: z.string(),
        state: ExpertState,
        tested: z.boolean(),
        official: z.boolean().default(false),
      }),
    ),
    apps: z.array(z.object({ id: z.string().min(1), name: z.string(), state: z.string() })),
    browse_experts: z.array(Choice),
    browse_apps: z.array(Choice),
    popular: z.array(AppRow).default([]),
    app_groups: z
      .array(
        z.object({
          service: z.string(),
          official: AppRow.nullable(),
          others: z.array(AppRow),
        }),
      )
      .default([]),
    next_cursor: z.string().nullable().default(null),
    sources: z.object({ apps: RegistrySource, experts: RegistrySource }).nullable().default(null),
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
  .transform(({ browse_experts, browse_apps, app_groups, next_cursor, ...rest }) => ({
    ...rest,
    browseExperts: browse_experts,
    browseApps: browse_apps,
    appGroups: app_groups,
    nextCursor: next_cursor,
  }));

export type SetupOverview = z.infer<typeof Wire>;
export type SetupExpert = SetupOverview['experts'][number];
export type AppRow = z.infer<typeof AppRow>;
export type AppGroup = { service: string; official: AppRow | null; others: AppRow[] };
export type RegistrySourceInfo = z.infer<typeof RegistrySource>;
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
