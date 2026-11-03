/**
 * The job page's Overview tab: Scout's own result (as safe Markdown), when the job started and
 * finished and how long it ran, and who worked on it (each expert, plus the apps and tools Scout
 * used, read from the labels on the timeline). It invents no result: with none written it shows
 * the status and points to Reports. Contains OverviewTab and workers.
 */
import type { JobActivityEntry } from '../host-bridge';
import type { PartView } from './job-activity-state';
import { localDateTime, ranFor } from './job-time';
import { SafeMarkdown } from './safe-markdown';

const STATE_TEXT: Record<string, string> = {
  running: 'Still running.',
  done: 'Finished.',
  error: 'Ended with an error.',
  stopped: 'Stopped.',
};

/** Apps and tools seen on the timeline, by label (`app:<id>` / `scout:<tool>`), first seen first. */
export function workers(entries: JobActivityEntry[]): { apps: string[]; tools: string[] } {
  const apps = new Set<string>();
  const tools = new Set<string>();
  for (const { source } of entries) {
    if (source?.startsWith('app:')) apps.add(source.slice(4));
    else if (source?.startsWith('scout:')) tools.add(source.slice(6));
  }
  return { apps: [...apps], tools: [...tools] };
}

export function OverviewTab({
  state,
  result,
  parts,
  entries,
  startedAt,
  endedAt,
  now,
  onReports,
}: {
  state: string;
  result: string | null;
  parts: PartView[];
  entries: JobActivityEntry[];
  startedAt: string;
  endedAt: string | null;
  now: number;
  onReports: () => void;
}) {
  const { apps, tools } = workers(entries);
  const experts = [...new Set(parts.map((p) => p.expert))];
  const nobody = experts.length === 0 && apps.length === 0 && tools.length === 0;
  return (
    <div className="job-overview">
      {result ? (
        <section aria-labelledby="job-result-h">
          <h2 id="job-result-h" className="job-overview__h">
            Scout&rsquo;s result
          </h2>
          <SafeMarkdown text={result} />
        </section>
      ) : (
        <p className="job-overview__status">
          {STATE_TEXT[state] ?? state}
          {parts.length > 0 && (
            <>
              {' '}
              <button type="button" className="job-overview__link" onClick={onReports}>
                See the reports
              </button>
            </>
          )}
        </p>
      )}
      <dl className="job-overview__facts">
        <div>
          <dt>Started</dt>
          <dd>{localDateTime(startedAt)}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{endedAt === null ? '—' : localDateTime(endedAt)}</dd>
        </div>
        <div>
          <dt>Ran for</dt>
          <dd>{ranFor(startedAt, endedAt, now)}</dd>
        </div>
        <div>
          <dt>Worked on by</dt>
          <dd>
            {nobody ? (
              '—'
            ) : (
              <ul className="job-overview__who">
                {experts.map((name) => (
                  <li key={`e:${name}`}>{name}</li>
                ))}
                {apps.map((name) => (
                  <li key={`a:${name}`}>{name} (app)</li>
                ))}
                {tools.map((name) => (
                  <li key={`t:${name}`}>{name} (Scout tool)</li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
