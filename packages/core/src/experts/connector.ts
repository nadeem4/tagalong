/**
 * The contract between a companion and an expert.
 *
 * A companion never does the work: it writes a `Brief` and hands it to a `Connector`,
 * which carries it to whatever the expert really is (a command-line agent, a model API,
 * a tool server) and brings back a `ConnectorResult`. Each kind of expert is one adapter.
 */

/** What the companion sends: the ask in the user's words and what they were looking at. */
export interface Brief {
  ask: string;
  context?: { app?: string; windowTitle?: string; selection?: string };
  /** Paths the companion thinks matter, relative to the expert's folder where it can. */
  files?: string[];
  /** What a good answer looks like, so the expert knows when it is done. */
  goodAnswer?: string;
}

export type ConnectorResult =
  { ok: true; text: string; changedFiles: string[] } | { ok: false; error: string };

export interface Connector {
  /**
   * Sends one brief and resolves with the expert's answer. `onProgress` gets short
   * human-readable steps ("Reading src/main.ts") while the expert works. Never throws:
   * every failure comes back as `{ ok: false }` so the companion can say what happened.
   */
  send(
    brief: Brief,
    onProgress: (step: string) => void,
    signal?: AbortSignal,
  ): Promise<ConnectorResult>;
}

export const CANCELLED: ConnectorResult = { ok: false, error: 'Cancelled.' };

/** The brief as plain text, the form every connector can pass on. */
export function renderBrief(brief: Brief): string {
  const sections = [brief.ask];
  const { app, windowTitle, selection } = brief.context ?? {};
  const looking = [app && `App: ${app}`, windowTitle && `Window: ${windowTitle}`].filter(Boolean);
  if (looking.length > 0) sections.push(`What I was looking at:\n${looking.join('\n')}`);
  if (selection) sections.push(`Selected text:\n${selection}`);
  if (brief.files && brief.files.length > 0) {
    sections.push(`Files that matter:\n${brief.files.map((f) => `- ${f}`).join('\n')}`);
  }
  if (brief.goodAnswer) sections.push(`A good answer: ${brief.goodAnswer}`);
  return sections.join('\n\n');
}
