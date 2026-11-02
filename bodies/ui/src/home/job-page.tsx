/**
 * The job page in Home: one job's activity as a read-only log, live while the job runs. It pulls
 * the brain's job_activity by cursor on mount and on every `job_activity` notice, follows the
 * newest line until the person scrolls up, and offers Jump to latest. Contains JobPage.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import { useHostBridge } from '../host-bridge';
import type { JobRow } from '../host-bridge';
import { Button } from '../controls/button';
import { applyPage, emptyLog, type LogState } from './job-activity-state';
import { JobLog } from './job-log';

const STATE_LABEL: Record<string, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  stopped: 'Stopped',
};
/** Within this many pixels of the end counts as "at the end". */
const END_SLACK = 24;

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}m ${total % 60}s` : `${total}s`;
}

export function JobPage({ job, onBack }: { job: JobRow; onBack: () => void }) {
  const bridge = useHostBridge();
  const [log, setLog] = useState<LogState>(() => ({ ...emptyLog(), state: job.state }));
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [following, setFollowing] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const rev = useRef(0);
  const busy = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);

  // One pull at a time: a notice that lands mid-pull is folded into one more pull after it.
  const pull = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        let more = true;
        while (more && alive.current) {
          const page = await bridge.jobActivity(job.id, rev.current);
          if (!alive.current) return;
          rev.current = Math.max(rev.current, page.rev);
          setLog((current) => applyPage(current, page));
          setFailed(false);
          more = page.more;
        }
      } while (again.current && alive.current);
    } catch (error: unknown) {
      console.error('could not read job activity', error);
      if (alive.current) setFailed(true);
    } finally {
      busy.current = false;
    }
  }, [bridge, job.id]);

  useEffect(() => {
    alive.current = true;
    void pull();
    const off = bridge.onBrainChanged((what) => {
      if (what === 'job_activity') void pull();
    });
    return () => {
      alive.current = false;
      off();
    };
  }, [bridge, pull]);

  const running = log.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (following && el) el.scrollTop = el.scrollHeight;
  }, [log.entries, following]);

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const el = event.currentTarget;
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight <= END_SLACK);
  };

  const jumpToLatest = (): void => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setFollowing(true);
  };

  const stop = (): void => {
    void bridge
      .stopJob(job.id)
      .catch((error: unknown) => console.error('could not stop job', error))
      .then(() => pull());
  };

  const started = Date.parse(job.startedAt);
  const ended = job.endedAt === null ? now : Date.parse(job.endedAt);
  return (
    <>
      <div className="home-head">
        <button type="button" className="job-page__back" onClick={onBack}>
          Jobs
        </button>
        <div className="job-page__title">
          <h1 className="home-title">{job.task}</h1>
          <span className={`job-row__state job-row__state--${log.state}`}>
            {STATE_LABEL[log.state] ?? log.state}
          </span>
          <span className="home-time job-page__time">{clock(ended - started)}</span>
          {running && (
            <Button variant="secondary" aria-label={`Stop ${job.task}`} onClick={stop}>
              Stop
            </Button>
          )}
        </div>
      </div>
      {failed && (
        <p role="alert" className="job-page__alert">
          Tagalong could not read this job&rsquo;s steps. What is shown may be out of date; it loads
          again when the job changes.
        </p>
      )}
      <div className="job-page__frame">
        <JobLog entries={log.entries} now={now} logRef={logRef} onScroll={onScroll} />
        {!following && (
          <button type="button" className="job-page__jump" onClick={jumpToLatest}>
            Jump to latest
          </button>
        )}
      </div>
    </>
  );
}
