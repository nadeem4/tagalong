/**
 * `budgetSpent`: the one budget check for proactive work. Keep-an-eye remarks and
 * scheduled routines (meeting prep included) call it before they start; any new proactive
 * model work must too. Nudges make no model call. Direct asks, Run now, a watch the person
 * started, a confirmed hand-off and a summary never call it.
 *
 * Checked only when something starts, never in the middle. Only priced dollars count,
 * so on the Claude sign-in alone the cap never trips.
 */
export function budgetSpent(
  usage: { todayUsd(): number },
  dailyUsd: () => number | null,
): () => boolean {
  return () => {
    const cap = dailyUsd();
    if (cap === null) return false;
    try {
      return usage.todayUsd() >= cap;
    } catch {
      // A spend that cannot be read lets work through rather than silencing Scout.
      return false;
    }
  };
}
