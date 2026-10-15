/**
 * The one budget check for proactive work. Keep-an-eye comments and scheduled routines
 * call it before they start; anything else Scout starts on its own (nudges, meeting
 * prep, a daily briefing) must call this same gate. Direct asks, Run now, a watch the
 * person started, a confirmed hand-off and a summary never call it.
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
