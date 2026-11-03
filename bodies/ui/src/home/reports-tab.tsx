/**
 * The job page's Reports tab: one collapsed row per part (expert, state, times). Expanding a row
 * asks the brain for that part's report once (job_report) and shows it as safe Markdown; nothing
 * is fetched or rendered until then, so a very long report costs nothing while closed.
 * Contains ReportsTab.
 */
import { useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { PartView } from './job-activity-state';
import { localTime, ranFor } from './job-time';
import { SafeMarkdown } from './safe-markdown';

type Report =
  { status: 'loading' } | { status: 'failed' } | { status: 'ready'; text: string | null };

function PartReport({ job, part, now }: { job: string; part: PartView; now: number }) {
  const bridge = useHostBridge();
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  const load = (): void => {
    setReport({ status: 'loading' });
    bridge.jobReport(job, part.id).then(
      (text) => setReport({ status: 'ready', text }),
      (error: unknown) => {
        console.error('could not read the report', error);
        setReport({ status: 'failed' });
      },
    );
  };
  const toggle = (): void => {
    setOpen(!open);
    if (!open && report === null) load();
  };
  const body = `job-report-${part.id}`;
  return (
    <li className="job-report">
      <button
        type="button"
        className="job-report__head"
        aria-expanded={open}
        aria-controls={body}
        onClick={toggle}
      >
        <span className="job-report__name">{part.expert}</span>
        <span className={`job-row__state job-row__state--${part.state}`}>{part.state}</span>
        <span className="home-time job-report__when">
          {localTime(part.startedAt)} &middot; {ranFor(part.startedAt, part.endedAt, now)}
        </span>
      </button>
      <div id={body} hidden={!open} className="job-report__body">
        {open && report?.status === 'loading' && (
          <p className="job-report__note">Loading&hellip;</p>
        )}
        {open && report?.status === 'failed' && (
          <p role="alert" className="job-report__note">
            Tagalong could not read this report.{' '}
            <button type="button" className="job-overview__link" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {open &&
          report?.status === 'ready' &&
          (report.text ? (
            <SafeMarkdown text={report.text} />
          ) : (
            <p className="job-report__note">This part has not written a report.</p>
          ))}
      </div>
    </li>
  );
}

export function ReportsTab({ job, parts, now }: { job: string; parts: PartView[]; now: number }) {
  if (parts.length === 0) {
    return <p className="job-report__note">No expert has worked on this job.</p>;
  }
  return (
    <ul className="job-reports">
      {parts.map((part) => (
        <PartReport key={part.id} job={job} part={part} now={now} />
      ))}
    </ul>
  );
}
