/**
 * What a remote brain waits on from this PC: approve a program, install an expert, sign one in.
 * The brain only asks; the person's yes runs this PC's own `tagalong` command here, and only then
 * is the brain told to try again. Every fact the card shows (who asks, where the program is) is
 * read here, never taken from the brain's frame. Also lists and revokes what is approved here.
 */
import { NodeNeedsParams, type NodeNeedsOpen } from '@tagalong/contract';
import type { ApprovedItem, NeedsYouItem } from '@tagalong/ui/shapes';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { z } from 'zod';
import { lastLine } from '../last-line';

interface Open {
  frame: NodeNeedsOpen;
  state: NeedsYouItem['state'];
  bubble: boolean;
  failure?: string;
}

export interface NeedsYouDeps {
  /** Runs `tagalong <args>` on this PC. */
  run: (args: string[]) => Promise<{ code: number; out: string }>;
  answer: (id: string, outcome: 'done' | 'not_now') => Promise<void>;
  /** The full path of a program on this PC's PATH, or null. */
  resolve: (command: string) => string | null;
  /** The paired brain's name. */
  brain: () => string;
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

/** Where `command` is on this PC's PATH, the way a shell would find it, or null. */
export function onPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')];
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = join(dir, command + ext);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

const words = (spec: {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
}): string => spec.url ?? [spec.command ?? '', ...(spec.args ?? [])].join(' ').trim();

export function createNeedsYou(deps: NeedsYouDeps) {
  const open = new Map<string, Open>();
  const found = new Map<string, string | null>();
  const where = (command: string): string | null => {
    if (!found.has(command)) found.set(command, deps.resolve(command));
    return found.get(command) ?? null;
  };
  const list = (): NeedsYouItem[] =>
    [...open.values()].map(({ frame, state, bubble, failure }) => ({
      id: frame.id,
      need: frame.need,
      brain: deps.brain(),
      what: words(frame.spec),
      path: frame.spec.command === undefined ? null : where(frame.spec.command),
      expert: frame.expert,
      state,
      failure,
      bubble,
    }));
  const changed = (): void => deps.push(list());

  const command = ({ frame }: Open): string[] => {
    if (frame.need === 'install') return ['install', frame.expert ?? ''];
    if (frame.need === 'signin') return ['login', frame.expert ?? ''];
    const { command: program = '', args = [], url } = frame.spec;
    if (url !== undefined) return ['node', 'allow', '--url', url];
    return ['node', 'allow', program, ...(args.length > 0 ? ['--', ...args] : [])];
  };

  return {
    list,

    frame(raw: unknown): void {
      const parsed = NodeNeedsParams.safeParse(raw);
      if (!parsed.success) return;
      const frame = parsed.data;
      if (frame.state === 'closed') {
        if (open.delete(frame.id)) changed();
        return;
      }
      open.set(frame.id, { frame, state: 'waiting', bubble: true });
      changed();
    },

    async act(id: string): Promise<{ error?: string }> {
      const need = open.get(id);
      if (need === undefined) return {};
      need.state = 'working';
      delete need.failure;
      changed();
      const done = await deps.run(command(need));
      if (done.code !== 0) {
        need.state = 'failed';
        need.failure = lastLine(done.out) || 'It did not finish.';
        changed();
        return { error: need.failure };
      }
      open.delete(id);
      found.clear();
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
