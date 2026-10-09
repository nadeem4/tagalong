import { CANCELLED, type Brief, type Connector, type ConnectorResult } from './connector';

export interface FakeConnectorScript {
  steps?: string[];
  text?: string;
  changedFiles?: string[];
  /** When set, the hand-off fails with this message instead of answering. */
  error?: string;
}

/** Scripted expert for tests and `TAGALONG_FAKE_PROVIDERS=1`: no process, no network. */
export class FakeConnector implements Connector {
  readonly sent: Brief[] = [];

  constructor(private readonly script: FakeConnectorScript) {}

  async send(
    brief: Brief,
    onProgress: (step: string) => void,
    signal?: AbortSignal,
  ): Promise<ConnectorResult> {
    this.sent.push(brief);
    if (signal?.aborted) return CANCELLED;
    for (const step of this.script.steps ?? []) onProgress(step);
    if (this.script.error !== undefined) return { ok: false, error: this.script.error };
    return { ok: true, text: this.script.text ?? '', changedFiles: this.script.changedFiles ?? [] };
  }
}
