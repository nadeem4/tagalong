/**
 * Home's Jobs panel, on the Jobs page: the Claude Code jobs Scout handed work to, newest first,
 * with a Stop on running ones and the result of finished ones. The brain owns the jobs; this
 * lists them and reads again when the brain says they changed. Watch opens a job's page in
 * place of the list. Contains JobsPanel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { JobRow } from '../host-bridge';
import { Button } from '../controls/button';
import { JobPage } from './job-page';

const STATE_LABEL: Record<string, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  stopped: 'Stopped',
};

/** "2m 5s" for a finished job; the start time for one still running. */
function when(job: JobRow): string {
  const started = new Date(job.startedAt);
  if (job.endedAt === null) {
    return `Started ${started.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  const seconds = Math.max(
    0,
    Math.round((new Date(job.endedAt).getTime() - started.getTime()) / 1000),
  );
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function JobsPanel() {
  const bridge = useHostBridge();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [watching, setWatching] = useState<string | null>(null);

  const refresh = useCallback(() => {
    bridge
      .listJobs()
      .then((latest) => {
        setFailed(false);
        setJobs(latest);
      })
      .catch((error: unknown) => {
        console.error('could not list jobs', error);
        setFailed(true);
      });
  }, [bridge]);

  useEffect(() => {
    refresh();
    return bridge.onBrainChanged((what) => {
      if (what === 'jobs') refresh();
    });
  }, [bridge, refresh]);

  const stop = (job: JobRow): void => {
    void bridge
      .stopJob(job.id)
      // Read again either way: a refusal usually means the job had just ended.
      .catch((error: unknown) => console.error('could not stop job', error))
      .then(refresh);
  };

  const toggle = (id: string): void =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Coming back from a job page, focus returns to that job's Watch button.
  const listRef = useRef<HTMLUListElement>(null);
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    if (watching !== null || returnTo.current === null) return;
    const id = returnTo.current;
    returnTo.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-watch="${CSS.escape(id)}"]`)?.focus();
  }, [watching, jobs]);

  const watched = watching === null ? undefined : jobs?.find((job) => job.id === watching);
  if (watched) {
    return (
      <JobPage
        job={watched}
        onBack={() => {
          returnTo.current = watched.id;
          setWatching(null);
        }}
      />
    );
  }

  return (
    <>
      <div className="home-head">
        <h1 className="home-title">Jobs</h1>
        <p>Work Scout has handed to Claude Code.</p>
      </div>
      <section className="home-card" aria-label="Jobs">
        <h2 className="home-card__label">JOBS</h2>
        {failed && jobs === null && (
          <p role="alert">
            Tagalong could not read the jobs. They load again when Home reopens or a job changes.
          </p>
        )}
        {jobs !== null && jobs.length === 0 && (
          <p>No jobs yet. Ask Scout to hand work to Claude Code and it shows here.</p>
        )}
        {jobs !== null && jobs.length > 0 && (
          <ul aria-label="Jobs" className="job-list" ref={listRef}>
            {jobs.map((job) => (
              <li key={job.id} className="job-row">
                <div className="job-row__main">
                  <span className="job-row__task" title={job.task}>
                    {job.task}
                  </span>
                  <span className="job-row__meta">
                    <span className={`job-row__state job-row__state--${job.state}`}>
                      {STATE_LABEL[job.state] ?? job.state}
                    </span>
                    <span className="job-row__where">
                      {job.folder} · {job.mode} · <span className="home-time">{when(job)}</span>
                    </span>
                  </span>
                  {job.state === 'running' && job.progress !== null && (
                    <span className="job-row__text">{job.progress}</span>
                  )}
                  {job.reason !== null && job.state !== 'running' && (
                    <span className="job-row__text">{job.reason}</span>
                  )}
                </div>
                <div className="job-row__actions">
                  {job.activity && (
                    <Button
                      variant="secondary"
                      aria-label={`Watch ${job.task}`}
                      data-watch={job.id}
                      onClick={() => setWatching(job.id)}
                    >
                      Watch
                    </Button>
                  )}
                  {job.state === 'running' && (
                    <Button
                      variant="secondary"
                      aria-label={`Stop ${job.task}`}
                      onClick={() => stop(job)}
                    >
                      Stop
                    </Button>
                  )}
                  {job.state !== 'running' && job.result !== null && (
                    <Button
                      variant="secondary"
                      aria-expanded={open.has(job.id)}
                      onClick={() => toggle(job.id)}
                    >
                      {open.has(job.id) ? 'Hide result' : 'Show result'}
                    </Button>
                  )}
                </div>
                {open.has(job.id) && job.result !== null && (
                  <pre className="job-row__result">{job.result}</pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
