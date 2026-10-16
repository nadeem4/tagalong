/**
 * The contract between a companion and an expert.
 *
 * A companion never does the work: it writes a `Brief` and hands it to a `Connector`,
 * which carries it to whatever the expert really is and brings back a `ConnectorResult`.
 * Each kind of expert is one adapter; Claude Code is the one that ships. Also holds
 * renderBrief and CANCELLED.
 */
import { hideSecrets } from '../privacy/secrets';
import type { Brief, HandoffStepKind } from '@tagalong/protocol';

export type { Brief };

/**
 * What one run used, for the cost meter. Optional: a connector fills it when its tool
 * reports tokens (Claude Code's `result` event does). `model` is empty when unknown.
 */
export interface ConnectorUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type ConnectorResult =
  | { ok: true; text: string; changedFiles: string[]; usage?: ConnectorUsage }
  | { ok: false; error: string; usage?: ConnectorUsage };

export type CheckResult = { ok: true } | { ok: false; error: string };

/**
 * What a progress step is: a tool the expert used ("Reading src/main.ts"), a short line it
 * wrote between tools, which Scout may say aloud, or a note from the person, as it moves
 * from waiting to delivered (or dropped, when the run ended first).
 */
export type StepKind = HandoffStepKind;

/** Notes from the person for the running expert, taken once each when a turn ends. */
export interface NoteQueue {
  take(): string[];
}

export interface Connector {
  /** Whether the expert can be reached, without spending anything. */
  check(): Promise<CheckResult>;

  /**
   * Sends one brief and resolves with the expert's answer. `onProgress` gets short
   * human-readable steps ("Reading src/main.ts") while the expert works. Never throws:
   * every failure comes back as `{ ok: false }` so the companion can say what happened.
   * A connector that can carry on in the same session takes `notes` each time a turn ends
   * and passes them on; one that cannot ignores them, and the hand-off says they were dropped.
   */
  send(
    brief: Brief,
    onProgress: (step: string, kind?: StepKind) => void,
    signal?: AbortSignal,
    notes?: NoteQueue,
  ): Promise<ConnectorResult>;
}

export const CANCELLED: ConnectorResult = { ok: false, error: 'Cancelled.' };

/** The brief as plain text, the form every connector can pass on, with any secret hidden. */
export function renderBrief(brief: Brief): string {
  const sections = [brief.ask];
  const { app, windowTitle, selection, windowText } = brief.context ?? {};
  const looking = [app && `App: ${app}`, windowTitle && `Window: ${windowTitle}`].filter(Boolean);
  if (looking.length > 0) sections.push(`What I was looking at:\n${looking.join('\n')}`);
  if (windowText) sections.push(`The end of that window:\n${windowText}`);
  if (selection) sections.push(`Selected text:\n${selection}`);
  if (brief.files && brief.files.length > 0) {
    sections.push(`Files that matter:\n${brief.files.map((f) => `- ${f}`).join('\n')}`);
  }
  if (brief.goodAnswer) sections.push(`A good answer: ${brief.goodAnswer}`);
  return hideSecrets(sections.join('\n\n'));
}
