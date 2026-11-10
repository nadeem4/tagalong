/**
 * The Now card at the top of the Tasks page: what is live this minute. Asks waiting for the
 * person come first (Deny, Always, Allow), then running jobs with their current step and a
 * clock, mail being read, and timers about to fire. Each source is read on its own and again
 * when the brain says it changed, so one that fails never hides the others. Contains NowCard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { JobRow, RunningStep } from '../host-bridge';
import type { ConnectorConfirmParams, LoopApp, TimerRow, TurnEvent } from '../shapes';
import { Button } from '../controls/button';

const SOON_S = 3600; // a timer this close to firing is "now"

/** A gate ask the person can allow or deny here. Job asks and expert questions stay in the bubble. */
function isGate(ask: ConnectorConfirmParams): boolean {
  return ask.question !== true && (ask.options?.includes('allow') ?? false);
}

function elapsed(startedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function NowCard({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const bridge = useHostBridge();
  const [asks, setAsks] = useState<ConnectorConfirmParams[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [steps, setSteps] = useState<RunningStep[]>([]);
  const [apps, setApps] = useState<LoopApp[]>([]);
  const [timers, setTimers] = useState<TimerRow[]>([]);
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  // An ask answered elsewhere before the first read came back must not appear from it.
  const dismissed = useRef(new Set<string>());

  const read = useCallback((source: string, promise: Promise<void>): void => {
    void promise
      .catch((error: unknown) => console.error(`could not read ${source}`, error))
      .then(() => setSettled((current) => new Set(current).add(source)));
  }, []);
  const readJobs = useCallback(
    () =>
      read(
        'jobs',
        Promise.all([bridge.listJobs(), bridge.runningSteps().catch(() => [])]).then(
          ([rows, running]) => {
            setJobs(rows.filter((row) => row.state === 'running'));
            setSteps(running);
          },
        ),
      ),
    [bridge, read],
  );
  const readApps = useCallback(
    () =>
      read(
        'mail',
        bridge.loopsState().then((state) => setApps(state.apps)),
      ),
    [bridge, read],
  );
  const readTimers = useCallback(
    () => read('timers', bridge.timersState().then(setTimers)),
    [bridge, read],
  );

  useEffect(() => {
    let live = true;
    const take = (event: TurnEvent): void => {
      if (event.type === 'connector.confirm') {
        const { type: _type, ...ask } = event;
        if (dismissed.current.has(ask.approvalId)) return;
        setAsks((current) =>
          current.some((a) => a.approvalId === ask.approvalId)
            ? current.map((a) => (a.approvalId === ask.approvalId ? ask : a))
            : [...current, ask],
        );
      } else if (event.type === 'connector.dismiss') {
        dismissed.current.add(event.approvalId);
        setAsks((current) => current.filter((a) => a.approvalId !== event.approvalId));
      }
    };
    const stopEvents = bridge.onTurnEvent(take);
    read(
      'asks',
      (bridge.openConfirms?.() ?? Promise.resolve([])).then((open) => {
        if (live) open.forEach(take);
      }),
    );
    readJobs();
    readApps();
    readTimers();
    const stopChanges = bridge.onBrainChanged((what) => {
      if (what === 'jobs' || what === 'job_activity') readJobs();
      else if (what === 'loops' || what === 'apps') readApps();
      else if (what === 'timers') readTimers();
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      live = false;
      stopEvents();
      stopChanges();
      clearInterval(tick);
    };
  }, [bridge, read, readJobs, readApps, readTimers]);

  const answer = (ask: ConnectorConfirmParams, decision: 'once' | 'always' | 'deny'): void => {
    dismissed.current.add(ask.approvalId);
    setAsks((current) => current.filter((a) => a.approvalId !== ask.approvalId));
    void bridge.approveTool(ask.approvalId, decision).catch((error: unknown) => {
      console.error('could not answer the ask', error);
      // The brain never heard the answer: the ask is still open there, so show it again.
      dismissed.current.delete(ask.approvalId);
      setAsks((current) =>
        current.some((a) => a.approvalId === ask.approvalId) ? current : [ask, ...current],
      );
    });
  };
  const stop = (id: string): void => {
    setStopping((current) => new Set(current).add(id));
    void bridge
      .stopJob(id)
      .catch((error: unknown) => console.error('could not stop the job', error))
      .then(readJobs) // either way: a refusal usually means it had just ended
      .finally(() =>
        setStopping((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        }),
      );
  };

  const waiting = asks.filter(isGate);
  const reading = apps.filter((app) => app.on && app.unreadSince === undefined);
  const soon = timers.filter((t) => {
    const left = new Date(t.nextAt).getTime() - now;
    return left > 0 && left <= SOON_S * 1000; // one that has passed is firing, not "in 0 min"
  });
  const empty = waiting.length + jobs.length + reading.length + soon.length === 0;

  return (
    <section className="home-card now" aria-label="Now">
      <h2 className="home-card__label">NOW</h2>
      {waiting.map((ask) => (
        <div key={ask.approvalId} className="now__row now__ask">
          <span className="now__body">
            <span className="now__title">{ask.summary}</span>
            {ask.risk === 'high' && <span className="now__meta">Can’t be undone</span>}
          </span>
          <span className="now__actions">
            <Button
              variant="quiet"
              aria-label={`Deny ${ask.summary}`}
              onClick={() => answer(ask, 'deny')}
            >
              Deny
            </Button>
            {ask.options?.includes('always') === true && (
              <Button
                variant="secondary"
                aria-label={`Always ${ask.summary}`}
                onClick={() => answer(ask, 'always')}
              >
                Always
              </Button>
            )}
            <Button
              variant="primary"
              aria-label={`Allow ${ask.summary}`}
              onClick={() => answer(ask, 'once')}
            >
              Allow
            </Button>
          </span>
        </div>
      ))}
      {jobs.map((job) => {
        const live = steps.find((s) => s.job === job.id);
        return (
          <div key={job.id} className="now__row">
            <span className="now__body">
              <span className="now__title">{job.title ?? job.task}</span>
              {live !== undefined && <span className="now__meta">{live.text}</span>}
            </span>
            <span className="now__actions">
              <span className="home-time">{elapsed(job.startedAt, now)}</span>
              <Button
                variant="secondary"
                aria-label={`Open ${job.title ?? job.task}`}
                onClick={() => onOpenJob(job.id)}
              >
                Open
              </Button>
              <Button
                variant="secondary"
                aria-label={`Stop ${job.title ?? job.task}`}
                disabled={stopping.has(job.id)}
                onClick={() => stop(job.id)}
              >
                Stop
              </Button>
            </span>
          </div>
        );
      })}
      {reading.map((app) => (
        <div key={app.id} className="now__row">
          <span className="now__title">Reading {app.name} mail</span>
        </div>
      ))}
      {soon.map((timer) => (
        <div key={timer.id} className="now__row">
          <span className="now__title">{timer.note}</span>
          <span className="now__meta">
            in {Math.max(1, Math.ceil((new Date(timer.nextAt).getTime() - now) / 60_000))} min
          </span>
        </div>
      ))}
      {empty && settled.size >= 4 && <p>Nothing is running right now.</p>}
    </section>
  );
}
