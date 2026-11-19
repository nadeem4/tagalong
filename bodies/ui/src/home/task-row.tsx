/**
 * One row of the Tasks page's task list: the task's title, its kind and state, who started it
 * (the root of its caused-by chain, else the task's own source) and Stop while it is live. The
 * page above reads the tasks and passes them in. Contains TaskRow.
 */
import { useState } from 'react';
import type { TaskRow as Task } from '../shapes';
import { Button } from '../controls/button';

const KINDS: Record<string, string> = { watch: 'Watch', own: 'Own', do: 'Do', later: 'Later' };
const STATES: Record<string, string> = {
  open: 'Running',
  waiting: 'Waiting',
  done: 'Done',
  stopped: 'Stopped',
};

export function TaskRow({
  task,
  onStop,
}: {
  task: Task;
  onStop: (id: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const stop = (): void => {
    setBusy(true);
    void Promise.resolve(onStop(task.id)).finally(() => setBusy(false));
  };
  const name = task.title ?? KINDS[task.kind] ?? task.kind;
  const from = task.chain.length > 0 ? task.chain[task.chain.length - 1]!.source : task.source;
  const live = task.state === 'open' || task.state === 'waiting';
  return (
    <li className="loops-row">
      <span className="loops-row__body">
        <span className="loops-row__title">{name}</span>
        <span className="loops-row__meta">
          <span>{KINDS[task.kind] ?? task.kind}</span>
          <span>{STATES[task.state] ?? task.state}</span>
          <span>from {from}</span>
        </span>
      </span>
      {live && (
        <Button variant="quiet" aria-label={`Stop ${name}`} disabled={busy} onClick={stop}>
          Stop
        </Button>
      )}
    </li>
  );
}
