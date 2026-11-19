/** Tests for TaskRow: a task with its state and who started it, and Stop while it is live. */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskRow as Task } from '../shapes';
import { TaskRow } from './task-row';

const base: Task = {
  id: 't1',
  kind: 'watch',
  state: 'open',
  title: 'Watching Gmail',
  source: 'timer:w1',
  chain: [],
  createdAt: '2026-11-17T08:00:00+00:00',
  endedAt: null,
};

const row = (task: Task, onStop: (id: string) => void = () => undefined) =>
  render(
    <ul>
      <TaskRow task={task} onStop={onStop} />
    </ul>,
  );

describe('TaskRow', () => {
  it('stops a task from its row', () => {
    const onStop = vi.fn();
    row(base, onStop);
    fireEvent.click(screen.getByRole('button', { name: 'Stop Watching Gmail' }));
    expect(onStop).toHaveBeenCalledWith('t1');
  });

  it('shows who started it', () => {
    row({
      ...base,
      chain: [
        { kind: 'timer', source: 'timer:w1' },
        { kind: 'say', source: 'desktop' },
      ],
    });
    expect(screen.getByText('from desktop')).toBeVisible();
    expect(screen.getByText('Watch')).toBeVisible();
    expect(screen.getByText('Running')).toBeVisible();
  });

  it('names the task source when no event led to it', () => {
    row({ ...base, source: 'scout' });
    expect(screen.getByText('from scout')).toBeVisible();
  });

  it('names the failed and declined states', () => {
    row({ ...base, state: 'failed', endedAt: 'x' });
    expect(screen.getByText('Failed')).toBeVisible();
    row({ ...base, id: 't2', state: 'declined', endedAt: 'x' });
    expect(screen.getByText('Declined')).toBeVisible();
  });

  it('hides Stop on an ended task', () => {
    row({ ...base, state: 'done', endedAt: '2026-11-17T09:00:00+00:00' });
    expect(screen.getByText('Done')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Stop/ })).toBeNull();
  });
});
