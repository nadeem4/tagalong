/**
 * The history half of Home's Approvals page: a summary strip, the All / Decided by Scout /
 * Refused filter and every permission ask grouped by local day, with who decided and how it
 * ended. Rows Scout decided carry the sentence they relied on. Contains ApprovalHistory.
 */
import type { ReactNode } from 'react';
import type { ApprovalCounts, ApprovalRow } from '../host-bridge';

export type ApprovalFilter = 'all' | 'scout' | 'refused';

interface Props {
  /** Null until the first read lands. */
  rows: readonly ApprovalRow[] | null;
  /** Null until a read succeeds. */
  counts: ApprovalCounts | null;
  filter: ApprovalFilter;
  onFilter(filter: ApprovalFilter): void;
  hasMore: boolean;
  onMore(): void;
}

const SOURCE: Record<ApprovalRow['source'], { label: string; icon: ReactNode }> = {
  claude_code: { label: 'Claude Code expert', icon: <path d="M3 3h10v7H8l-3 3v-3H3z" /> },
  scout_tool: {
    label: 'Scout tool',
    icon: (
      <>
        <circle cx="8" cy="8" r="2" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
      </>
    ),
  },
  app: {
    label: 'Connected app',
    icon: <path d="M6 10l4-4M5 7L3 9a2.5 2.5 0 003.5 3.5L8 11M11 9l2-2A2.5 2.5 0 009.5 3.5L8 5" />,
  },
};

const OUTCOME: Record<ApprovalRow['outcome'], { label: string; chip: string }> = {
  approved: { label: 'Approved', chip: 'tg-chip tg-chip--ok' },
  refused: { label: 'Refused', chip: 'tg-chip tg-chip--err' },
  timed_out: { label: 'Timed out', chip: 'tg-chip tg-chip--warn' },
  no_one: { label: 'No one online', chip: 'tg-chip' },
};

const FILTERS: readonly { id: ApprovalFilter; label: string; count: keyof ApprovalCounts }[] = [
  { id: 'all', label: 'All', count: 'total' },
  { id: 'scout', label: 'Decided by Scout', count: 'scout' },
  { id: 'refused', label: 'Refused', count: 'refused' },
];

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Local-calendar key, so a day boundary is the person's midnight, not UTC's. */
const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return 'Today';
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Rows arrive newest first; consecutive rows of one day share a group. */
function groupByDay(rows: readonly ApprovalRow[]): { label: string; rows: ApprovalRow[] }[] {
  const groups: { key: string; label: string; rows: ApprovalRow[] }[] = [];
  for (const row of rows) {
    const key = dayKey(new Date(row.at));
    const last = groups.at(-1);
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, label: dayLabel(row.at), rows: [row] });
  }
  return groups;
}

function Row({ row }: { row: ApprovalRow }) {
  const source = SOURCE[row.source];
  const outcome = OUTCOME[row.outcome];
  const byScout = row.decidedBy === 'scout';
  return (
    <li className={byScout ? 'apv-row apv-row--scout' : 'apv-row'}>
      <span className="apv-row__time">{time(row.at)}</span>
      <svg className="apv-row__icon" viewBox="0 0 16 16" aria-hidden="true">
        {source.icon}
      </svg>
      <div className="apv-row__body">
        <span className="apv-row__what">{row.summary}</span>
        <span className="apv-row__source">{source.label}</span>
        {byScout && (
          <span className="apv-row__by apv-row__by--scout">
            <b>Scout decided, per your preference</b>
            <em>{` “${row.preference ?? ''}”`}</em>
          </span>
        )}
        {row.decidedBy === 'person' && (
          <span className="apv-row__by">
            Decided by <b>you</b>
          </span>
        )}
      </div>
      <div className="apv-row__side">
        <span className={outcome.chip}>{outcome.label}</span>
        {byScout && <span className="apv-pill">Auto</span>}
      </div>
    </li>
  );
}

export function ApprovalHistory({ rows, counts, filter, onFilter, hasMore, onMore }: Props) {
  // Before a successful read there is nothing true to show; the page's alert speaks instead.
  if (rows === null || counts === null) return null;
  return (
    <section aria-label="Approvals history" className="apv-section">
      <div className="home-card apv-summary" role="group" aria-label="Summary">
        <div>
          <b>{counts.total}</b>
          <span>asks</span>
        </div>
        <i className="apv-summary__sep" />
        <div>
          <b>{counts.scout}</b>
          <span>Scout answered</span>
        </div>
        <i className="apv-summary__sep" />
        <div>
          <b>{counts.refused}</b>
          <span>refused</span>
        </div>
      </div>
      <div className="apv-bar">
        <h2 className="home-card__label">HISTORY</h2>
        <div className="apv-seg" role="group" aria-label="Filter history">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filter === item.id}
              onClick={() => onFilter(item.id)}
            >
              {item.label}
              <span className="apv-seg__n">{counts[item.count]}</span>
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 && <p className="home-note">Nothing here yet.</p>}
      {groupByDay(rows).map((group) => (
        <div key={group.label + group.rows[0]?.id}>
          <h3 className="home-card__label apv-day">{group.label}</h3>
          <ul className="apv-rows">
            {group.rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
        </div>
      ))}
      {hasMore && (
        <button type="button" className="apv-btn apv-more" onClick={onMore}>
          Show more
        </button>
      )}
    </section>
  );
}
