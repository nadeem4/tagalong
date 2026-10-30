/**
 * Home's Jobs panel, on the Jobs page: the Claude Code jobs Scout handed work to, newest first,
 * with a Stop on running ones and the result of finished ones. The brain owns the jobs; this
 * lists them and reads again when the brain says they changed. Contains JobsPanel.
 */
import { useCallback, useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { JobRow } from '../host-bridge';

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

  const refresh = useCallback(() => {
    const list = bridge.listJobs;
    if (list === undefined) return;
    list
      .call(bridge)
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
    return bridge.onBrainChanged?.((what) => {
      if (what === 'jobs') refresh();
    });
  }, [bridge, refresh]);

  const stop = (job: JobRow): void => {
    void bridge
      .stopJob?.(job.id)
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

  if (bridge.listJobs === undefined) return null;

  return (
    <section className="home-card home-jobs" aria-label="Jobs">
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
        <ul aria-label="Jobs" className="job-list">
          {jobs.map((job) => (
            <li key={job.id} className="job-row">
              <div className="job-row__head">
                <span className="job-row__task">{job.task}</span>
                <span className={`job-row__state job-row__state--${job.state}`}>
                  {STATE_LABEL[job.state] ?? job.state}
                </span>
              </div>
              <span className="job-row__meta">
                {job.folder} · {job.mode} · {when(job)}
              </span>
              {job.state === 'running' && job.progress !== null && (
                <span className="job-row__text">{job.progress}</span>
              )}
              {job.reason !== null && job.state !== 'running' && (
                <span className="job-row__text">{job.reason}</span>
              )}
              <div className="job-row__actions">
                {job.state === 'running' && (
                  <button
                    type="button"
                    className="tg-btn-quiet"
                    aria-label={`Stop ${job.task}`}
                    onClick={() => stop(job)}
                  >
                    Stop
                  </button>
                )}
                {job.state !== 'running' && job.result !== null && (
                  <button
                    type="button"
                    className="tg-btn-quiet"
                    aria-expanded={open.has(job.id)}
                    onClick={() => toggle(job.id)}
                  >
                    {open.has(job.id) ? 'Hide result' : 'Show result'}
                  </button>
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
  );
}
