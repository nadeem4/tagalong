/**
 * Home's Tasks page: the work Scout has on its plate. A title, the Now card (what is live), then three tabs with counts read
 * from the brain (Jobs, Waiting news and mail loops, Timers, and All tasks: every task with its
 * source and a Stop). Opening a job (Watch on a row) shows its page
 * in place of everything, and Back returns to the tab. The brain owns all of it; this reads the
 * counts and timers and reads again when it says `jobs`, `events` or `timers` changed.
 * Contains TasksView.
 */
import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import { JobsPanel } from './jobs-panel';
import { JobTabs, panelId, tabId } from './job-tabs';
import { NowCard } from './now-card';
import { TaskRow } from './task-row';
import { TimersTab } from './timers-tab';
import { WaitingTab } from './waiting-tab';
import type { TaskRow as Task, TimerRow, WaitingEvent } from '../shapes';

const isLive = (t: Task): boolean => t.state === 'open' || t.state === 'waiting';
type Tab = 'jobs' | 'waiting' | 'timers' | 'tasks';

export function TasksView() {
  const bridge = useHostBridge();
  const [tab, setTab] = useState<Tab>('jobs');
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [waiting, setWaiting] = useState<WaitingEvent[] | null>(null);
  const [timers, setTimers] = useState<TimerRow[] | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);

  // Each source is read on its own: one that fails leaves the others, and its count blank.
  const readJobs = useCallback(() => {
    bridge
      .listJobs()
      .then((jobs) => setJobCount(jobs.length))
      .catch((error: unknown) => console.error('could not count jobs', error));
  }, [bridge]);
  const readWaiting = useCallback(() => {
    bridge
      .eventsWaiting()
      .then(setWaiting)
      .catch((error: unknown) => console.error('could not read waiting news', error));
  }, [bridge]);
  const readTimers = useCallback(() => {
    bridge
      .timersState()
      .then(setTimers)
      .catch((error: unknown) => console.error('could not read timers', error));
  }, [bridge]);

  const readTasks = useCallback(() => {
    bridge
      .tasksList()
      .then((rows) => setTasks(rows.filter((row) => row.kind !== 'ask')))
      .catch((error: unknown) => console.error('could not read tasks', error));
  }, [bridge]);

  useEffect(() => {
    readJobs();
    readWaiting();
    readTimers();
    readTasks();
    return bridge.onBrainChanged((what) => {
      if (what === 'jobs') readJobs();
      else if (what === 'events') readWaiting();
      else if (what === 'timers') readTimers();
    });
  }, [bridge, readJobs, readWaiting, readTimers, readTasks]);

  const cancelTimer = (id: string): Promise<void> =>
    bridge
      .cancelTimer(id)
      .catch((error: unknown) => console.error('could not cancel the timer', error))
      .then(readTimers); // either way: on a refusal the tab shows what the brain holds

  // The brain does not announce task changes: read on opening the tab and after a Stop.
  const stopTask = (id: string): Promise<void> =>
    bridge
      .stopTask(id)
      .catch((error: unknown) => console.error('could not stop the task', error))
      .then(readTasks);
  const selectTab = (id: Tab): void => {
    setTab(id);
    if (id === 'tasks') readTasks();
  };

  const label = (name: string, count: number | null): string =>
    count === null ? name : `${name} (${count})`;
  const tabs = [
    { id: 'jobs', label: label('Jobs', jobCount) },
    { id: 'waiting', label: label('Waiting', waiting === null ? null : waiting.length) },
    { id: 'timers', label: label('Timers', timers === null ? null : timers.length) },
    { id: 'tasks', label: label('All tasks', tasks === null ? null : tasks.filter(isLive).length) },
  ];

  const viewing = openJob === null;
  return (
    <>
      {viewing && (
        <div className="home-head">
          <h1 className="home-title">Tasks</h1>
          <p>What Scout is working on, holding and waiting for.</p>
        </div>
      )}
      {viewing && <NowCard onOpenJob={setOpenJob} />}
      {viewing && (
        <JobTabs
          label="Tasks sections"
          tabs={tabs}
          selected={tab}
          onSelect={(id) => selectTab(id as Tab)}
        />
      )}
      {/* Always one panel in this spot, so the Jobs list keeps its state while a job page is open. */}
      <div
        {...(viewing ? { role: 'tabpanel', id: panelId(tab), 'aria-labelledby': tabId(tab) } : {})}
        className="tasks-panel"
      >
        {(tab === 'jobs' || !viewing) && (
          <JobsPanel embedded openJob={openJob} onOpenJob={setOpenJob} />
        )}
        {viewing && tab === 'waiting' && <WaitingTab events={waiting ?? []} />}
        {viewing && tab === 'timers' && <TimersTab timers={timers ?? []} onCancel={cancelTimer} />}
        {viewing && tab === 'tasks' && (
          <section className="tg-card" aria-label="All tasks">
            <h2 className="tg-card__label">All tasks</h2>
            {(tasks ?? []).length === 0 ? (
              <p>No tasks.</p>
            ) : (
              <ul aria-label="Task list" className="loops-list">
                {(tasks ?? []).map((task) => (
                  <TaskRow key={task.id} task={task} onStop={stopTask} />
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
