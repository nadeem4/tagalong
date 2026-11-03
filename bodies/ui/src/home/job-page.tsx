/**
 * The job page in Home: a title, state and Scout's watch list over three tabs (Overview,
 * Activity, Reports). It pulls the brain's job_activity by cursor on mount and on every
 * `job_activity` notice; the Activity log is live while the job runs, follows the newest line
 * until the person scrolls up, and offers Jump to latest. The chosen tab is kept in this page's
 * state, so live updates never reset it. Contains JobPage.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import { useHostBridge } from '../host-bridge';
import type { JobRow } from '../host-bridge';
import { Button } from '../controls/button';
import { applyPage, emptyLog, type LogState, type PartView } from './job-activity-state';
import { JobLog } from './job-log';
import { clock } from './job-time';
import { JobTabs, panelId, tabId } from './job-tabs';
import { OverviewTab } from './overview-tab';
import { ReportsTab } from './reports-tab';
import { WatchList } from './watch-list';

const STATE_LABEL: Record<string, string> = {
  running: 'Running',
  done: 'Done',
  error: 'Error',
  stopped: 'Stopped',
};
/** Within this many pixels of the end counts as "at the end". */
const END_SLACK = 24;

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'activity', label: 'Activity' },
  { id: 'reports', label: 'Reports' },
];

/** An old job has no title; its brief's first line stands in. */
function headline(title: string | null, task: string): string {
  return (
    title?.trim() ||
    task
      .split(/\r?\n/)
      .find((line) => line.trim() !== '')
      ?.trim() ||
    task
  );
}

export function JobPage({ job, onBack }: { job: JobRow; onBack: () => void }) {
  const bridge = useHostBridge();
  const [log, setLog] = useState<LogState>(() => ({ ...emptyLog(), state: job.state }));
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [following, setFollowing] = useState(true);
  // Chosen once from the state the page opens in; a job finishing under you does not move you.
  const [tab, setTab] = useState(job.state === 'running' ? 'activity' : 'overview');
  const logRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
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

  // The list that had focus is gone, so land on the page's heading.
  useEffect(() => headingRef.current?.focus(), []);

  const running = log.state === 'running';
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (following && el) el.scrollTop = el.scrollHeight;
  }, [log.entries, following, tab]);

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

  const startedAt = log.startedAt ?? job.startedAt;
  const endedAt = log.startedAt === null ? job.endedAt : log.endedAt;
  const parts: PartView[] =
    log.parts ??
    job.parts.map((p) => ({
      id: p.id,
      expert: p.expert,
      state: p.state,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
    }));
  const heading = headline(log.title ?? job.title, job.task);
  const ended = endedAt === null ? now : Date.parse(endedAt);
  const started = Date.parse(startedAt);
  return (
    <>
      <div className="home-head">
        <button type="button" className="job-page__back" aria-label="Back to Jobs" onClick={onBack}>
          Jobs
        </button>
        <div className="job-page__title">
          <h1 className="home-title" ref={headingRef} tabIndex={-1}>
            {heading}
          </h1>
          <span className={`job-row__state job-row__state--${log.state}`}>
            {STATE_LABEL[log.state] ?? log.state}
          </span>
          <span className="home-time job-page__time">{clock(ended - started)}</span>
          {running && (
            <Button variant="secondary" aria-label={`Stop ${heading}`} onClick={stop}>
              Stop
            </Button>
          )}
        </div>
        <WatchList items={log.watch} />
      </div>
      {failed && (
        <p role="alert" className="job-page__alert">
          Tagalong could not read this job&rsquo;s steps. What is shown may be out of date; it loads
          again when the job changes.
        </p>
      )}
      <JobTabs tabs={TABS} selected={tab} onSelect={setTab} />
      <div
        role="tabpanel"
        id={panelId('overview')}
        aria-labelledby={tabId('overview')}
        hidden={tab !== 'overview'}
        className="job-page__panel"
      >
        <OverviewTab
          state={log.state}
          result={log.result ?? job.scoutResult}
          parts={parts}
          entries={log.entries}
          startedAt={startedAt}
          endedAt={endedAt}
          now={now}
          onReports={() => setTab('reports')}
        />
      </div>
      <div
        role="tabpanel"
        id={panelId('activity')}
        aria-labelledby={tabId('activity')}
        hidden={tab !== 'activity'}
        className="job-page__frame"
      >
        <JobLog entries={log.entries} now={now} parts={parts} logRef={logRef} onScroll={onScroll} />
        {!following && (
          <button type="button" className="job-page__jump" onClick={jumpToLatest}>
            Jump to latest
          </button>
        )}
      </div>
      <div
        role="tabpanel"
        id={panelId('reports')}
        aria-labelledby={tabId('reports')}
        hidden={tab !== 'reports'}
        className="job-page__panel"
      >
        <ReportsTab job={job.id} parts={parts} now={now} />
      </div>
    </>
  );
}
