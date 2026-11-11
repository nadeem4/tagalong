/**
 * Home's Jobs panel, on the Tasks page: the Claude Code jobs Scout handed work to, newest first,
 * with a Stop on running ones and the result of finished ones. The brain owns the jobs; this
 * lists them and reads again when the brain says they changed. Watch opens a job's page in
 * place of the list. Contains JobsPanel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { JobRow } from '../host-bridge';
import { Button } from '../controls/button';
import { JobPage } from './job-page';
import { SafeMarkdown } from './safe-markdown';

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

interface JobsPanelProps {
  /** Under the Tasks page, which owns the heading: no `h1` of its own. */
  embedded?: boolean;
  /**
   * The open job page, when the host keeps it (the Tasks page opens one from the Now card too).
   * Without `onOpenJob` the panel keeps it itself.
   */
  openJob?: string | null;
  onOpenJob?: (id: string | null) => void;
}

export function JobsPanel({ embedded = false, openJob = null, onOpenJob }: JobsPanelProps = {}) {
  const bridge = useHostBridge();
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [ownWatching, setOwnWatching] = useState<string | null>(null);
  const watching = onOpenJob === undefined ? ownWatching : openJob;
  const setWatching = onOpenJob ?? setOwnWatching;
  // The whole result by job id. The list rows are Scout's compact copy (cut at 1000 characters);
  // Home reads the full text when a row opens, and shows the row's copy until it arrives.
  const [full, setFull] = useState<Readonly<Record<string, string>>>({});

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

  const loadFull = (job: JobRow): void => {
    const part = job.parts[job.parts.length - 1];
    // A cursor past every step: the page then carries Scout's result and no entries.
    bridge
      .jobActivity(job.id, Number.MAX_SAFE_INTEGER)
      .then((page) => page.result ?? (part ? bridge.jobReport(job.id, part.id) : null))
      .then((text) => {
        if (text !== null) setFull((current) => ({ ...current, [job.id]: text }));
      })
      .catch((error: unknown) => console.error('could not read the full result', error));
  };

  const toggle = (job: JobRow): void => {
    if (!open.has(job.id)) loadFull(job);
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(job.id)) next.add(job.id);
      return next;
    });
  };

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
      {!embedded && (
        <div className="home-head">
          <h1 className="home-title">Jobs</h1>
          <p>Work Scout has handed to Claude Code.</p>
        </div>
      )}
      <section className="tg-card" aria-label="Jobs">
        <h2 className="tg-card__label">Jobs</h2>
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
            {jobs.map((job) => {
              // One part until Scout splits a job; the row speaks for the newest one.
              const part = job.parts[job.parts.length - 1];
              const progress = part?.progress ?? null;
              const reason = part?.reason ?? null;
              // Scout's own result when it wrote one; the expert's report is the fallback.
              const result = job.scoutResult ?? part?.result ?? null;
              return (
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
                    {job.state === 'running' && progress !== null && (
                      <span className="job-row__text">{progress}</span>
                    )}
                    {reason !== null && job.state !== 'running' && (
                      <span className="job-row__text">{reason}</span>
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
                    {job.state !== 'running' && result !== null && (
                      <Button
                        variant="secondary"
                        aria-expanded={open.has(job.id)}
                        onClick={() => toggle(job)}
                      >
                        {open.has(job.id) ? 'Hide result' : 'Show result'}
                      </Button>
                    )}
                  </div>
                  {open.has(job.id) && result !== null && (
                    <div className="job-row__result">
                      <SafeMarkdown text={full[job.id] ?? result} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
