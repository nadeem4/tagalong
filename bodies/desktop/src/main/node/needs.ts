/**
 * What a remote brain waits on from this PC: approve a program, install an expert, sign one in.
 * The brain only asks; the person's yes runs this PC's own `tagalong` command here, and only then
 * is the brain told to try again. Every fact the card shows (who asks, where the program is) is
 * read here, never taken from the brain's frame. Also lists and revokes what is approved here.
 */
import { NodeNeedsParams } from '@tagalong/contract';
import type { ApprovedItem, NeedsYouItem } from '@tagalong/ui/shapes';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { z } from 'zod';

interface Spec {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
}

interface Open {
  item: NeedsYouItem;
  spec: Spec;
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

const lastLine = (out: string): string => out.trim().split('\n').at(-1) ?? 'It did not finish.';
const words = (spec: Spec): string =>
  spec.url ?? [spec.command ?? '', ...(spec.args ?? [])].join(' ').trim();

export function createNeedsYou(deps: NeedsYouDeps) {
  const open = new Map<string, Open>();
  const list = (): NeedsYouItem[] => [...open.values()].map((o) => o.item);
  const changed = (): void => deps.push(list());

  const command = (need: Open): string[] => {
    const { item, spec } = need;
    if (item.need === 'install') return ['install', item.expert ?? ''];
    if (item.need === 'signin') return ['login', item.expert ?? ''];
    if (spec.url !== undefined) return ['node', 'allow', '--url', spec.url];
    const args = spec.args ?? [];
    return ['node', 'allow', spec.command ?? '', ...(args.length > 0 ? ['--', ...args] : [])];
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
      const spec: Spec = frame.spec;
      open.set(frame.id, {
        spec,
        item: {
          id: frame.id,
          need: frame.need,
          brain: deps.brain(),
          what: words(spec),
          path: spec.command === undefined ? null : deps.resolve(spec.command),
          ...(frame.expert === undefined ? {} : { expert: frame.expert }),
          state: 'waiting',
          bubble: true,
        },
      });
      changed();
    },

    async act(id: string): Promise<{ error?: string }> {
      const need = open.get(id);
      if (need === undefined) return {};
      need.item = { ...need.item, state: 'working' };
      delete need.item.failure;
      changed();
      const done = await deps.run(command(need));
      if (done.code !== 0) {
        const failure = lastLine(done.out);
        need.item = { ...need.item, state: 'failed', failure };
        changed();
        return { error: failure };
      }
      open.delete(id);
      changed();
      await deps.answer(id, 'done');
      return {};
    },

    async notNow(id: string): Promise<void> {
      const need = open.get(id);
      if (need === undefined) return;
      need.item = { ...need.item, bubble: false };
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
        ...(r.path === undefined ? {} : { path: r.path }),
        ...(r.at === undefined ? {} : { at: r.at }),
      }));
    },

    async revoke(key: string): Promise<void> {
      await deps.run(['node', 'revoke', key]);
    },
  };
}
