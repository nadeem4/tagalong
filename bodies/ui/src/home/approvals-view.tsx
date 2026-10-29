/**
 * Home's Approvals page: the standing preferences Scout follows, a summary of how asks were
 * answered, and the history of every permission ask. The brain owns all of it; this reads it,
 * relays Remove and Edit, and reads again when the brain says approvals changed.
 * Contains ApprovalsView.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { ApprovalCounts, ApprovalRow, PreferenceRow } from '../host-bridge';
import { ApprovalHistory } from './approval-history';
import type { ApprovalFilter } from './approval-history';
import { PreferencesList } from './preferences-list';

export function ApprovalsView() {
  const bridge = useHostBridge();
  const [filter, setFilter] = useState<ApprovalFilter>('all');
  const [preferences, setPreferences] = useState<PreferenceRow[] | null>(null);
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [counts, setCounts] = useState<ApprovalCounts>({ total: 0, scout: 0, refused: 0 });
  const [next, setNext] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // Only the latest read may land: a slow answer for an earlier filter must not overwrite it.
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const list = bridge.listApprovals;
    if (list === undefined) return;
    const mine = ++latest.current;
    Promise.all([list.call(bridge, filter), bridge.listPreferences?.() ?? Promise.resolve([])])
      .then(([page, prefs]) => {
        if (mine !== latest.current) return;
        setFailed(false);
        setRows(page.approvals);
        setCounts(page.counts);
        setNext(page.next);
        setPreferences(prefs);
      })
      .catch((error: unknown) => {
        if (mine !== latest.current) return;
        console.error('could not read approvals', error);
        setFailed(true);
      });
  }, [bridge, filter]);

  useEffect(() => {
    refresh();
    return bridge.onBrainChanged?.((what) => {
      if (what === 'approvals') refresh();
    });
  }, [bridge, refresh]);

  const showMore = (): void => {
    if (next === null) return;
    bridge
      .listApprovals?.(filter, next)
      .then((page) => {
        setRows((current) => [...(current ?? []), ...page.approvals]);
        setNext(page.next);
      })
      .catch((error: unknown) => {
        console.error('could not read more approvals', error);
        setFailed(true);
      });
  };

  // Each action rejects when the brain refuses it, so the card can say so; the list is read
  // again after a success only.
  const remove = async (id: number): Promise<void> => {
    await bridge.removePreference?.(id);
    refresh();
  };
  const edit = async (id: number, sentence: string): Promise<void> => {
    await bridge.editPreference?.(id, sentence);
    refresh();
  };

  if (bridge.listApprovals === undefined) return null;

  return (
    <>
      <div>
        <h1 className="home-title">Approvals</h1>
        <p className="tg-note apv-sub">
          What you have let Scout and your experts do, and what Scout now handles for you.
        </p>
      </div>
      {failed && (
        <p role="alert" className="tg-error apv-error">
          Tagalong could not read the approvals. They load again when Home reopens or an approval
          changes.
        </p>
      )}
      <PreferencesList preferences={preferences ?? []} onRemove={remove} onEdit={edit} />
      <ApprovalHistory
        rows={rows}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        hasMore={next !== null}
        onMore={showMore}
      />
    </>
  );
}
