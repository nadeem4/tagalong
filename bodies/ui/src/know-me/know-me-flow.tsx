/**
 * The whole get-to-know-me flow in one piece, for the tour and for Home: the form, the progress
 * while a run goes, then the two-step result. It reads the host bridge from context.
 * Contains KnowMeFlow.
 */

import { useEffect, useState } from 'react';
import { useHostBridge } from '../host-bridge';
import type { MemoryEntry } from '../shapes';
import { ResultView, gapsFrom } from './result-view';
import { RunForm } from './run-form';
import { useKnowMe } from './use-know-me';

interface Result {
  portrait: string | null;
  facts: MemoryEntry[];
}

interface KnowMeFlowProps {
  /** The person pressed Looks right or Done. */
  onDone?: () => void;
  /** The run finished and its portrait and facts were read, so a list behind it can refresh. */
  onFinished?: () => void;
  /** Shown after Done when the parent does not close the flow itself. */
  doneNote?: string;
  /** A line under the progress while a run goes (the tour tells the person they may move on). */
  runningNote?: string;
}

export function KnowMeFlow({ onDone, onFinished, doneNote, runningNote }: KnowMeFlowProps) {
  const bridge = useHostBridge();
  const { sources, status, running, start, error } = useKnowMe();
  const [result, setResult] = useState<Result | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const finished = status?.done === true;

  useEffect(() => {
    if (!finished) {
      setResult(null);
      setAcknowledged(false);
      return;
    }
    let alive = true;
    Promise.all([bridge.getPortrait(), bridge.listMemories()])
      .then(([portrait, memories]) => {
        if (!alive) return;
        // Facts told in chat are not what this run read; the view lists only profile facts.
        const facts = memories.filter((m) => m.source !== undefined && m.source !== 'chat');
        setResult({ portrait: portrait ?? status?.portrait ?? null, facts });
        onFinished?.();
      })
      .catch((e: unknown) => {
        console.error('could not read the get to know me result', e);
        if (alive) setResult({ portrait: status?.portrait ?? null, facts: [] });
      });
    return () => {
      alive = false;
    };
    // The status object changes only when the run's state does; the callbacks are not deps on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, bridge]);

  if (finished && result !== null) {
    if (acknowledged && doneNote !== undefined) return <p className="know__sub">{doneNote}</p>;
    return (
      <ResultView
        portrait={result.portrait}
        gaps={gapsFrom(status)}
        facts={result.facts}
        onDone={() => {
          setAcknowledged(true);
          onDone?.();
        }}
      />
    );
  }

  const busy = running || finished;
  return (
    <>
      <RunForm
        sources={sources}
        onStart={(input) => void start(input)}
        running={busy}
        status={status}
        error={error}
      />
      {busy && runningNote !== undefined && <p className="know__sub">{runningNote}</p>}
    </>
  );
}
