/**
 * `WatchManager`: runs the watches `watch_for` starts. Polls a region through the host and
 * asks a small model only when it changed and held still. Also the `WATCH_*` timing
 * constants, `systemWatchClock` and `parseVerdict`.
 */
import { randomUUID } from 'node:crypto';
import type {
  DisplayBounds,
  NotificationParamsOf,
  PerceptionDiffResult,
  Pet,
  Settings,
  WatchState,
} from '@tagalong/protocol';
import type { BrainContentBlock, BrainProvider } from '../providers';
import { watchModelsFor } from '../providers';
import type { PerceptionHost } from '../perception';

/** How often a watch compares the region, in ms. */
export const WATCH_POLL_MS = 5_000;

/**
 * How soon a watch looks again once the region is moving. Short, so a command that just
 * finished is reported within seconds of its last line, not a full poll later.
 */
export const WATCH_SETTLE_MS = 2_000;

/**
 * The share of the region that must change before a model is asked anything.
 *
 * Half a percent. A blinking cursor is far below it; one new line of terminal output in a
 * window-sized region is above it. Most ticks never reach a model, which is the point.
 */
export const WATCH_CHANGE_THRESHOLD = 0.005;

/** The tail of a watched window's text a text-only check reads. */
const TEXT_TAIL_CHARS = 4_000;

/** Longest timeout a pet may ask for, whatever it says. */
const MAX_TIMEOUT_MINUTES = 240;

const CHECK_SYSTEM =
  "You watch part of a user's screen for one condition. Decide only whether the condition " +
  'is clearly true in what you are shown right now. Reply with JSON and nothing else: ' +
  '{"answer": "yes" or "no", "reason": "one short sentence about what you see"}. ' +
  'When unsure, answer no.';

/** Time, injected so the watch runs under a fake clock in tests. */
export interface WatchClock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemWatchClock: WatchClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type WatchEvent =
  | { method: 'watch.fired'; params: NotificationParamsOf<'watch.fired'> }
  | { method: 'watch.status'; params: NotificationParamsOf<'watch.status'> };

export interface WatchManagerOptions {
  clock: WatchClock;
  /** Read per tick: hosts connect and drop while a watch runs. */
  hosts: () => readonly PerceptionHost[];
  /** The pet's own provider. The check model runs on it, so no second key is needed. */
  provider: (pet: Pet) => BrainProvider;
  /** Read when a watch starts, so a limit saved in Settings applies to the next watch. */
  limits: () => Settings['watch'];
  emit: (event: WatchEvent) => void;
  log?: (message: string) => void;
}

export interface StartWatch {
  pet: Pet;
  condition: string;
  displayId: number;
  /** In display pixels. Absent watches the whole display. */
  rect?: DisplayBounds | undefined;
  /** The window a text-only check reads. Usually the one in front when the watch began. */
  windowId?: string | undefined;
  timeoutMinutes?: number | undefined;
}

export type StartOutcome =
  | { ok: true; watchId: string; timeoutMinutes: number; maxChecks: number }
  | { ok: false; reason: string };

export interface WatchInfo {
  watchId: string;
  petId: string;
  condition: string;
  displayId: number;
  checks: number;
  maxChecks: number;
}

interface Watch extends WatchInfo {
  pet: Pet;
  rect?: DisplayBounds | undefined;
  windowId?: string | undefined;
  deadline: number;
  /** When the frame the next check compares against was taken. */
  baselineAt: number;
  lastTickAt: number;
  timer: unknown;
}

type Verdict = { yes: boolean; reason: string };

/**
 * Watch mode: polls a region locally and asks a small model only when something changed.
 *
 * Each tick asks the host for two cheap ratios with no images — the region against the
 * previous tick, and against the frame at the last check — and a model is asked only when
 * the region has moved away from that frame *and then held still*. That is what keeps a
 * build's scrolling output from spending a check every five seconds, and what makes it one
 * check per change: after a "no", the frame it was asked about becomes the new baseline.
 *
 * The check runs on the pet's own provider with a small model (`watchModelsFor`). When that
 * provider cannot see, it reads the watched window's text instead, and with no text it cannot
 * check. Otherwise the crop is sent. A yes emits `watch.fired` and ends the watch.
 */
export class WatchManager {
  readonly #options: WatchManagerOptions;
  readonly #watches = new Map<string, Watch>();

  constructor(options: WatchManagerOptions) {
    this.#options = options;
  }

  active(): WatchInfo[] {
    return [...this.#watches.values()].map(
      ({ watchId, petId, condition, displayId, checks, maxChecks }) => ({
        watchId,
        petId,
        condition,
        displayId,
        checks,
        maxChecks,
      }),
    );
  }

  async start(request: StartWatch): Promise<StartOutcome> {
    const limits = this.#options.limits();
    if (this.#watches.size >= limits.maxConcurrent) {
      return {
        ok: false,
        reason:
          `Already watching ${this.#watches.size} things, the most allowed at once ` +
          `(${limits.maxConcurrent}). The user can stop one from its Watching chip.`,
      };
    }
    const condition = request.condition.trim();
    if (condition.length === 0) return { ok: false, reason: 'A watch needs a condition.' };

    const host = this.#diffHost();
    if (host === undefined) {
      return { ok: false, reason: 'No connected host can compare the screen over time.' };
    }

    const now = this.#options.clock.now();
    const timeoutMinutes = Math.min(
      MAX_TIMEOUT_MINUTES,
      Math.max(1, Math.round(request.timeoutMinutes ?? limits.defaultTimeoutMinutes)),
    );

    // The first diff gives the host a frame to compare later ones with; its answer is moot.
    try {
      await host.diff!({
        displayId: request.displayId,
        sinceSeconds: 1,
        includeImages: false,
        ...(request.rect === undefined ? {} : { rect: request.rect }),
      });
    } catch (error) {
      return {
        ok: false,
        reason: `The host could not look at display ${request.displayId}: ${message(error)}`,
      };
    }

    const watch: Watch = {
      watchId: randomUUID(),
      petId: request.pet.id,
      pet: request.pet,
      condition,
      displayId: request.displayId,
      rect: request.rect,
      windowId: request.windowId,
      checks: 0,
      maxChecks: limits.maxChecks,
      deadline: now + timeoutMinutes * 60_000,
      baselineAt: now,
      lastTickAt: now,
      timer: null,
    };
    this.#watches.set(watch.watchId, watch);
    this.#status(watch, 'watching');
    this.#schedule(watch, WATCH_POLL_MS);
    return { ok: true, watchId: watch.watchId, timeoutMinutes, maxChecks: limits.maxChecks };
  }

  /** The Stop button. False when the watch already ended. */
  stop(watchId: string): boolean {
    const watch = this.#watches.get(watchId);
    if (watch === undefined) return false;
    this.#end(watch, 'stopped');
    return true;
  }

  /** On shutdown. */
  stopAll(): void {
    for (const watch of [...this.#watches.values()]) this.#end(watch, 'stopped');
  }

  #diffHost(): PerceptionHost | undefined {
    return this.#options
      .hosts()
      .find((host) => host.capabilities.includes('recall') && typeof host.diff === 'function');
  }

  #schedule(watch: Watch, ms: number): void {
    watch.timer = this.#options.clock.setTimeout(() => void this.#tick(watch), ms);
  }

  #status(watch: Watch, state: WatchState, detail?: string): void {
    this.#options.emit({
      method: 'watch.status',
      params: {
        watchId: watch.watchId,
        petId: watch.petId,
        condition: watch.condition,
        displayId: watch.displayId,
        state,
        checks: watch.checks,
        maxChecks: watch.maxChecks,
        checkModel: watchModelsFor(watch.pet).model,
        ...(detail === undefined ? {} : { detail }),
      },
    });
  }

  #end(watch: Watch, state: Exclude<WatchState, 'watching'>, detail?: string): void {
    if (!this.#watches.delete(watch.watchId)) return;
    if (watch.timer !== null) this.#options.clock.clearTimeout(watch.timer);
    watch.timer = null;
    this.#status(watch, state, detail);
  }

  #live(watch: Watch): boolean {
    return this.#watches.get(watch.watchId) === watch;
  }

  async #tick(watch: Watch): Promise<void> {
    watch.timer = null;
    if (!this.#live(watch)) return;
    const now = this.#options.clock.now();
    if (now >= watch.deadline) {
      this.#end(watch, 'timeout', `Nothing matched "${watch.condition}" before the timeout.`);
      return;
    }

    const host = this.#diffHost();
    if (host === undefined) {
      this.#schedule(watch, WATCH_POLL_MS);
      return;
    }

    let sinceTick: PerceptionDiffResult;
    let sinceBaseline: PerceptionDiffResult;
    try {
      sinceTick = await this.#diff(host, watch, now - watch.lastTickAt, false);
      sinceBaseline = await this.#diff(host, watch, now - watch.baselineAt, false);
    } catch (error) {
      // Paused sight, an excluded window in front, a host mid-reconnect: keep watching and
      // let the timeout bound it. Ending here would make every pause cancel every watch.
      this.#options.log?.(`watch ${watch.watchId} skipped a tick: ${message(error)}`);
      if (this.#live(watch)) this.#schedule(watch, WATCH_POLL_MS);
      return;
    }
    if (!this.#live(watch)) return;
    watch.lastTickAt = now;

    if (sinceBaseline.changeRatio < WATCH_CHANGE_THRESHOLD) {
      this.#schedule(watch, WATCH_POLL_MS);
      return;
    }
    if (sinceTick.changeRatio >= WATCH_CHANGE_THRESHOLD) {
      // Still moving. Look again soon, and ask once it holds still.
      this.#schedule(watch, WATCH_SETTLE_MS);
      return;
    }

    await this.#check(host, watch, now);
  }

  #diff(
    host: PerceptionHost,
    watch: Watch,
    elapsedMs: number,
    includeImages: boolean,
  ): Promise<PerceptionDiffResult> {
    return host.diff!({
      displayId: watch.displayId,
      sinceSeconds: Math.max(1, Math.round(elapsedMs / 1000)),
      includeImages,
      ...(watch.rect === undefined ? {} : { rect: watch.rect }),
    });
  }

  async #check(host: PerceptionHost, watch: Watch, now: number): Promise<void> {
    watch.checks += 1;
    let verdict: Verdict;
    try {
      verdict = await this.#ask(host, watch, now);
    } catch (error) {
      this.#options.log?.(`watch ${watch.watchId} check failed: ${message(error)}`);
      if (error instanceof CannotCheck) {
        this.#end(watch, 'error', error.message);
        return;
      }
      verdict = { yes: false, reason: '' };
    }
    if (!this.#live(watch)) return;

    if (verdict.yes) {
      this.#options.emit({
        method: 'watch.fired',
        params: {
          watchId: watch.watchId,
          petId: watch.petId,
          message: verdict.reason || `"${watch.condition}" — it happened.`,
          displayId: watch.displayId,
        },
      });
      this.#end(watch, 'fired');
      return;
    }

    // The frame this check judged becomes what the next change is measured against.
    watch.baselineAt = now;
    if (watch.checks >= watch.maxChecks) {
      this.#end(
        watch,
        'capped',
        `Checked ${watch.checks} times without seeing "${watch.condition}", the most one watch may.`,
      );
      return;
    }
    this.#status(watch, 'watching');
    this.#schedule(watch, WATCH_POLL_MS);
  }

  /** One yes-or-no call to the check model, with a picture or the window's text. */
  async #ask(host: PerceptionHost, watch: Watch, now: number): Promise<Verdict> {
    const provider = this.#options.provider(watch.pet);
    const models = watchModelsFor(watch.pet);
    const sees = provider.capabilities.vision;

    let content: BrainContentBlock[] | null = null;
    if (!sees) content = await this.#textEvidence(host, watch);
    if (content === null) {
      if (!sees) {
        throw new CannotCheck(
          `${models.model} cannot see images and the watched window gave no text to read.`,
        );
      }
      const diff = await this.#diff(host, watch, now - watch.baselineAt, true);
      const crop = diff.after;
      if (crop === undefined) return { yes: false, reason: '' };
      content = [{ type: 'image', mime: crop.mime, base64: crop.base64 }];
    }
    content.push({ type: 'text', text: `Condition: ${watch.condition}\nIs it true now?` });

    const result = await provider.complete(
      {
        model: models.model,
        system: CHECK_SYSTEM,
        messages: [{ role: 'user', content }],
        maxTokens: 120,
      },
      {
        onText: () => undefined,
        onToolUse: () => Promise.resolve({ content: 'No tools here.', isError: true }),
      },
      new AbortController().signal,
    );
    return parseVerdict(result.text);
  }

  /** The end of the watched window's text, or null when there is none to read. */
  async #textEvidence(host: PerceptionHost, watch: Watch): Promise<BrainContentBlock[] | null> {
    if (watch.windowId === undefined || typeof host.readText !== 'function') return null;
    if (!host.capabilities.includes('textLayer')) return null;
    try {
      const reading = await host.readText({ windowId: watch.windowId, maxChars: 50_000 });
      if (reading.blocked !== undefined || reading.text.trim().length === 0) return null;
      const tail = reading.text.slice(-TEXT_TAIL_CHARS);
      return [{ type: 'text', text: `The end of the watched window's text:\n${tail}` }];
    } catch {
      return null;
    }
  }
}

class CannotCheck extends Error {}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the check model's answer. JSON first, as asked; a small model that answers in
 * words instead still counts when it starts with a plain yes.
 */
export function parseVerdict(text: string): Verdict {
  const json = /\{[\s\S]*\}/.exec(text);
  if (json !== null) {
    try {
      const parsed = JSON.parse(json[0]) as { answer?: unknown; reason?: unknown };
      if (typeof parsed.answer === 'string') {
        return {
          yes: /^\s*yes\b/i.test(parsed.answer),
          reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
        };
      }
    } catch {
      // Fall through to the plain reading.
    }
  }
  const yes = /^\W*yes\b/i.test(text);
  return { yes, reason: yes ? text.replace(/^\W*yes\b\W*/i, '').trim() : '' };
}
