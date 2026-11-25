/**
 * What a remote brain waits on from this PC: approve a program, sign an expert in.
 * The brain only asks; the person's yes runs this PC's own `tagalong` command here, and only then
 * is the brain told to try again. Every fact the card shows (who asks, where the program is) is
 * read here, never taken from the brain's frame; the path comes from the same `tagalong` that
 * `allow` will use, so the card names the program that gets approved. Also lists and revokes
 * what is approved here.
 */
import { NodeNeedsParams, type NodeNeedsOpen } from '@tagalong/contract';
import type { ApprovedItem, NeedsYouItem } from '@tagalong/ui/shapes';
import { z } from 'zod';
import { lastLine } from '../last-line';

interface Open {
  frame: NodeNeedsOpen;
  path: string | null;
  brain: BrainFacts;
  state: NeedsYouItem['state'];
  bubble: boolean;
  failure?: string;
}

export interface BrainFacts {
  name: string;
  /** The paired brain's certificate as a short code, to tell two brains of one name apart. */
  identity?: string | undefined;
}

export interface NeedsYouDeps {
  /** Runs `tagalong <args>` on this PC. */
  run: (args: string[]) => Promise<{ code: number; out: string }>;
  answer: (id: string, outcome: 'done' | 'not_now') => Promise<void>;
  /** The paired brain's name and identity. */
  brain: () => Promise<BrainFacts>;
  push: (items: NeedsYouItem[]) => void;
}

const Listed = z.array(
  z.object({
    key: z.string(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    at: z.string().optional(),
  }),
);

const words = (spec: {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
}): string => spec.url ?? [spec.command ?? '', ...(spec.args ?? [])].join(' ').trim();

export function createNeedsYou(deps: NeedsYouDeps) {
  const open = new Map<string, Open>();
  const arriving = new Set<string>();
  const list = (): NeedsYouItem[] =>
    [...open.values()].map(({ frame, path, brain, state, bubble, failure }) => ({
      id: frame.id,
      need: frame.need,
      brain: brain.name,
      identity: brain.identity,
      what: words(frame.spec),
      path,
      expert: frame.expert,
      state,
      failure,
      bubble,
    }));
  const changed = (): void => deps.push(list());

  const whichPath = async (command: string | undefined): Promise<string | null> => {
    if (command === undefined) return null;
    const done = await deps.run(['node', 'which', command]);
    return done.code === 0 ? lastLine(done.out) : null;
  };

  /** What to run for a request, or null when the brain asked for something this PC will not run. */
  const command = ({ frame }: Open): string[] | null => {
    if (frame.need !== 'approve') {
      if (frame.expert.startsWith('-')) return null;
      return ['login', frame.expert];
    }
    const { command: program = '', args = [], url } = frame.spec;
    if (url !== undefined) return ['node', 'allow', '--url', url];
    if (program.startsWith('-')) return null;
    return ['node', 'allow', program, ...(args.length > 0 ? ['--', ...args] : [])];
  };

  return {
    list,

    /** Resolves true when the request is now open here, so the caller can bring the card up. */
    async frame(raw: unknown): Promise<boolean> {
      const parsed = NodeNeedsParams.safeParse(raw);
      if (!parsed.success) return false;
      const frame = parsed.data;
      if (frame.state === 'closed') {
        arriving.delete(frame.id);
        if (open.delete(frame.id)) changed();
        return false;
      }
      arriving.add(frame.id);
      const [path, brain] = await Promise.all([whichPath(frame.spec.command), deps.brain()]);
      if (!arriving.delete(frame.id)) return false;
      open.set(frame.id, { frame, path, brain, state: 'waiting', bubble: true });
      changed();
      return true;
    },

    async act(id: string): Promise<{ error?: string }> {
      const need = open.get(id);
      if (need === undefined) return {};
      need.state = 'working';
      delete need.failure;
      changed();
      const args = command(need);
      const done =
        args === null ? { code: 1, out: 'This PC will not run that.' } : await deps.run(args);
      if (done.code !== 0) {
        need.state = 'failed';
        need.failure = lastLine(done.out) || 'It did not finish.';
        changed();
        return { error: need.failure };
      }
      open.delete(id);
      changed();
      await deps.answer(id, 'done');
      return {};
    },

    async notNow(id: string): Promise<void> {
      const need = open.get(id);
      if (need === undefined) return;
      need.bubble = false;
      changed();
      await deps.answer(id, 'not_now');
    },

    async approved(): Promise<ApprovedItem[]> {
      const done = await deps.run(['node', 'list']);
      if (done.code !== 0) return [];
      const rows = Listed.safeParse(JSON.parse(done.out));
      if (!rows.success) return [];
      return rows.data.map((r) => ({
        key: r.key,
        what: words(r),
        path: r.path,
        at: r.at,
      }));
    },

    async revoke(key: string): Promise<void> {
      await deps.run(['node', 'revoke', key]);
    },
  };
}
