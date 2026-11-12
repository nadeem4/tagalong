/**
 * What the Connections page and the tour read of the brain's setup: installed experts and apps
 * with a state, what could be added, and a running install's progress. Contains
 * parseSetupOverview and the SetupOverview types, shaped after the brain's setup_overview
 * (brain/src/brain/setup/home_tools.py).
 */
import { z } from 'zod';

const ExpertState = z.enum(['ready', 'needs_login']);
const Choice = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  // Old brains do not send it; an expert row is Official only when the brain says so.
  official: z.boolean().default(false),
  // The curated experts: one is Recommended; Tested means Scout ran it. Old brains send neither.
  recommended: z.boolean().default(false),
  tested: z.boolean().default(false),
  // Already installed: the row says Added instead of offering Add.
  added: z.boolean().default(false),
  // The curated claim that it signs in with the person's own account (the registry is silent).
  account: z.boolean().default(false),
  // For the check card; the ACP registry's licence and code address, empty when it has none.
  licence: z.string().default(''),
  repo: z.string().default(''),
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
  // A curated row for an app already added: it says Added instead of offering Add.
  added: z.boolean().default(false),
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
    apps: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        state: z.string(),
        // The trust kept at install; an old brain does not say, so it reads as Community.
        official: z.boolean().default(false),
      }),
    ),
    browse_experts: z.array(Choice),
    browse_apps: z.array(Choice),
    popular: z.array(AppRow).default([]),
    popular_more: z.array(AppRow).default([]),
    // Where "Show more" starts in browse_experts; null (an old brain) means nothing is hidden.
    show_more_from: z.number().nullable().default(null),
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
  .transform(
    ({
      browse_experts,
      browse_apps,
      app_groups,
      next_cursor,
      popular_more,
      show_more_from,
      ...rest
    }) => ({
      ...rest,
      browseExperts: browse_experts,
      browseApps: browse_apps,
      appGroups: app_groups,
      nextCursor: next_cursor,
      popularMore: popular_more,
      showMoreFrom: show_more_from,
    }),
  );

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
  /** A login's answer: `waiting`; how it ends arrives later as a setup_login event. */
  state?: string;
  /** The open item standing for the sign-in or install, and whether it joined one running. */
  item?: string;
  joined?: boolean;
}
