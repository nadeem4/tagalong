/**
 * FakeConnector: a scripted expert for tests and TAGALONG_FAKE_PROVIDERS=1. No process, no
 * network.
 */
import {
  CANCELLED,
  type Brief,
  type CheckResult,
  type Connector,
  type ConnectorResult,
  type NoteQueue,
  type StepKind,
} from './connector';

export interface FakeConnectorScript {
  steps?: string[];
  /** Lines the expert writes between tools, reported as `say` steps after `steps`. */
  says?: string[];
  text?: string;
  changedFiles?: string[];
  /** When set, the hand-off fails with this message instead of answering. */
  error?: string;
  /** When set, `check` fails with this message. */
  checkError?: string;
}

/** Scripted expert: records each brief and plays back its script. */
export class FakeConnector implements Connector {
  readonly sent: Brief[] = [];
  /** Every note from the person it took, as a live session would at the end of a turn. */
  readonly notes: string[] = [];

  constructor(private readonly script: FakeConnectorScript) {}

  check(): Promise<CheckResult> {
    const error = this.script.checkError;
    return Promise.resolve(error === undefined ? { ok: true } : { ok: false, error });
  }

  async send(
    brief: Brief,
    onProgress: (step: string, kind?: StepKind) => void,
    signal?: AbortSignal,
    notes?: NoteQueue,
  ): Promise<ConnectorResult> {
    this.sent.push(brief);
    if (signal?.aborted) return CANCELLED;
    for (const step of this.script.steps ?? []) onProgress(step);
    for (const line of this.script.says ?? []) onProgress(line, 'say');
    if (this.script.error !== undefined) return { ok: false, error: this.script.error };
    // One turn: the notes waiting when it ends are taken, as a live session would.
    this.notes.push(...(notes?.take() ?? []));
    return { ok: true, text: this.script.text ?? '', changedFiles: this.script.changedFiles ?? [] };
  }
}
