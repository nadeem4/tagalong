/**
 * Home's Tasks page: the work Scout has on its plate. A title, then three tabs with counts read
 * from the brain (Jobs, Held mail loops, Timers). Opening a job (Watch on a row) shows its page
 * in place of everything, and Back returns to the tab. The brain owns all of it; this reads the
 * counts and timers and reads again when it says `jobs`, `loops` or `timers` changed.
 * Contains TasksView.
 */
import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import { HeldTab } from './held-tab';
import { JobsPanel } from './jobs-panel';
import { JobTabs, panelId, tabId } from './job-tabs';
import { TimersTab } from './timers-tab';
import type { TimerRow } from '../shapes';

type Tab = 'jobs' | 'held' | 'timers';

export function TasksView() {
  const bridge = useHostBridge();
  const [tab, setTab] = useState<Tab>('jobs');
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [heldCount, setHeldCount] = useState<number | null>(null);
  const [timers, setTimers] = useState<TimerRow[] | null>(null);

  // Each source is read on its own: one that fails leaves the others, and its count blank.
  const readJobs = useCallback(() => {
    bridge
      .listJobs()
      .then((jobs) => setJobCount(jobs.length))
      .catch((error: unknown) => console.error('could not count jobs', error));
  }, [bridge]);
  const readHeld = useCallback(() => {
    bridge
      .loopsState()
      .then((state) =>
        setHeldCount(
          state.loops.filter((loop) => loop.status !== 'done' && loop.status !== 'dropped').length,
        ),
      )
      .catch((error: unknown) => console.error('could not count held loops', error));
  }, [bridge]);
  const readTimers = useCallback(() => {
    bridge
      .timersState()
      .then(setTimers)
      .catch((error: unknown) => console.error('could not read timers', error));
  }, [bridge]);

  useEffect(() => {
    readJobs();
    readHeld();
    readTimers();
    return bridge.onBrainChanged((what) => {
      if (what === 'jobs') readJobs();
      else if (what === 'loops') readHeld();
      else if (what === 'timers') readTimers();
    });
  }, [bridge, readJobs, readHeld, readTimers]);

  const cancelTimer = (id: string): void => {
    void bridge
      .cancelTimer(id)
      .catch((error: unknown) => console.error('could not cancel the timer', error))
      .then(readTimers); // either way: on a refusal the tab shows what the brain holds
  };

  const label = (name: string, count: number | null): string =>
    count === null ? name : `${name} (${count})`;
  const tabs = [
    { id: 'jobs', label: label('Jobs', jobCount) },
    { id: 'held', label: label('Held', heldCount) },
    { id: 'timers', label: label('Timers', timers === null ? null : timers.length) },
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
      {viewing && <JobTabs tabs={tabs} selected={tab} onSelect={(id) => setTab(id as Tab)} />}
      {/* Always one panel in this spot, so the Jobs list keeps its state while a job page is open. */}
      <div
        {...(viewing ? { role: 'tabpanel', id: panelId(tab), 'aria-labelledby': tabId(tab) } : {})}
        className="tasks-panel"
      >
        {(tab === 'jobs' || !viewing) && (
          <JobsPanel embedded openJob={openJob} onOpenJob={setOpenJob} />
        )}
        {viewing && tab === 'held' && <HeldTab />}
        {viewing && tab === 'timers' && <TimersTab timers={timers ?? []} onCancel={cancelTimer} />}
      </div>
    </>
  );
}
