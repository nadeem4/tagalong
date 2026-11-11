/**
 * What Home's Held list reads of the brain's loops: the mail apps the "Read my mail for loops"
 * switch is offered for, every loop held and every open item waiting on the person. Contains parseLoopsState and its types, shaped
 * after loops_state (brain/src/brain/loops/home_tools.py). A row never carries the mail itself.
 */
import { z } from 'zod';

const Loop = z.object({
  id: z.string().min(1),
  app: z.string(),
  title: z.string(),
  asks: z.string(),
  direction: z.enum(['i_owe', 'they_owe']),
  due: z.string().nullable(),
  people: z.array(z.string()),
  status: z.enum(['held', 'snoozed', 'done', 'dropped', 'stale']),
});

/** `unreadSince` is there only when mail stopped being read. */
export interface LoopApp {
  id: string;
  name: string;
  on: boolean;
  unreadSince?: string;
}

const App = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    on: z.boolean(),
    unread_since: z.string().optional(),
  })
  .transform(({ unread_since, ...rest }): LoopApp =>
    unread_since === undefined ? rest : { ...rest, unreadSince: unread_since },
  );

/** An open item: a card or offer still waiting on the person, with how long it has waited. */
const OpenItem = z
  .object({ id: z.string().min(1), kind: z.string(), title: z.string(), age_s: z.number() })
  .transform(({ age_s, ...rest }) => ({ ...rest, ageS: age_s }));

const Wire = z.object({
  apps: z.array(App),
  loops: z.array(Loop),
  open_items: z.array(OpenItem).default([]),
});

export type LoopsState = Omit<z.infer<typeof Wire>, 'open_items'> & {
  openItems: z.infer<typeof OpenItem>[];
};
export type OpenItemRow = z.infer<typeof OpenItem>;
export type LoopRow = z.infer<typeof Loop>;

export function parseLoopsState(json: unknown): LoopsState {
  const { open_items, ...rest } = Wire.parse(json);
  return { ...rest, openItems: open_items };
}
