/**
 * The check-in moment: the body notices something, and the mind decides whether it is worth
 * a word. Contains `CheckIn`, its options and the gate's limits.
 *
 * Code decides WHEN (the reasons below) and keeps every guardrail (one gate, `#wake`); the
 * mind decides IF and WHAT: a line, an offer for an expert, a face, or nothing. Nothing here
 * writes a sentence for Scout. Reasons: `settled` and `trouble` (from the window titles
 * keeping an eye sends), `long-stretch` (from the activity feed gentle nudges sends) and
 * `finished` (an expert's hand-off came back). Any failure is silence.
 */
import { randomUUID } from 'node:crypto';
import type {
  Brief,
  Expert,
  HandoffFinishedParams,
  Pet,
  PetMoodParams,
  PetRemarkParams,
  Settings,
  WindowEntry,
} from '@tagalong/protocol';
import type { BrainProvider } from '../providers';
import type { PerceptionHost } from '../perception';
import type { Memory } from '../memory/memories';
import { gatherNow, type NowSources } from '../conversation/now';
import { hideSecrets } from '../privacy/secrets';
import { soul } from '../roles';
import { Lookout, blind, callOrFullScreenInFront } from '../keep-an-eye/lookout';
import { ActiveTime } from './active-time';
import { RECENT_LINES, WINDOW_TEXT_CHARS, renderBundle, type BundleReason } from './bundle';
import { CHECK_IN_INSTRUCTIONS, CHECK_IN_TIMEOUT_MS, askMind, type CheckInReply } from './reply';

/** At most one unprompted check-in in this long, spoken or not. */
export const COOLDOWN_MS = 10 * 60_000;
/** How long "Not now" keeps unprompted check-ins quiet. */
export const NOT_NOW_MS = 60 * 60_000;
/** Check-ins a local day, every reason counted: the hard bound on cost. */
export const CHECK_IN_DAILY_CAP = 24;

type Kind = BundleReason['kind'];

export interface CheckInOptions {
  clock: { now(): number };
  /** The local hour (0-23) at a time; tests set the night. */
  hourOf?: (now: number) => number;
  /** The local day a time falls on, for the daily cap; tests may set it. */
  dayOf?: (now: number) => string;
  settings: () => Settings;
  pet: () => Pet | null;
  /** The engine's guarded, recorded and metered resolver. */
  provider: (pet: Pet) => BrainProvider;
  /** Text reads, for settled and trouble, and again on accept. */
  hosts: () => readonly PerceptionHost[];
  /** What is open, for the call and full-screen hold on reasons that bring no list. */
  windows: () => Promise<readonly WindowEntry[] | null>;
  experts: () => readonly Expert[];
  now: NowSources;
  /** `memory.recent(SCOUT_ID, 5)`. */
  memories: () => readonly Memory[];
  /** The last question and answer, or null before the first. */
  lastExchange: () => { said: string; answered: string } | null;
  /** Which expert a finished hand-off was and what it was asked. */
  handoff: (handoffId: string) => { expertName: string; ask: string } | null;
  /** `HandoffManager.propose`: the brief goes to the card, and nothing runs until Send. */
  propose: (params: {
    expertId: string;
    petId: string;
    brief: Brief;
    projectHint?: string;
  }) => unknown;
  emit: (
    event:
      | { method: 'pet.remark'; params: PetRemarkParams }
      | { method: 'pet.mood'; params: PetMoodParams },
  ) => void;
  /** The daily budget gate: true stops every check-in. */
  spentOut: () => boolean;
  log?: (message: string) => void;
  timeoutMs?: number;
}

/** What a wake found to ask about, once the gate let it through. */
interface Wake {
  reason: BundleReason;
  /** The window an offer is about (settled, trouble), read again on accept. */
  window?: WindowEntry;
  /** The front window for an offer's context (long-stretch). */
  front?: WindowEntry | null;
  handoffId?: string;
}

interface Offer {
  remarkId: string;
  petId: string;
  expertId: string;
  brief: Brief;
  window?: WindowEntry;
  projectHint?: string;
}

const localHour = (now: number): number => new Date(now).getHours();
const localDay = (now: number): string => new Date(now).toDateString();

export class CheckIn {
  readonly #o: CheckInOptions;
  readonly #lookout: Lookout;
  readonly #active = new ActiveTime();
  #activeMs: number | null = null;
  #busy = false;
  #quietUntil = Number.NEGATIVE_INFINITY;
  #lastUnpromptedAt = Number.NEGATIVE_INFINITY;
  #day = { key: '', calls: 0 };
  readonly #recent: string[] = [];
  #offer: Offer | null = null;
  #tired = false;

  constructor(options: CheckInOptions) {
    this.#o = options;
    this.#lookout = new Lookout(options.clock);
  }

  /** The window titles, every few seconds: settled and trouble. Resolves when handled. */
  async observeWindows(windows: readonly WindowEntry[]): Promise<void> {
    const settings = this.#o.settings();
    // Off means no tracking at all, not just no check-in.
    if (!settings.keepAnEye) return;
    const exclusions = settings.captureExclusions;
    this.#lookout.track(windows, exclusions);
    await this.#wake('settled', windows, async () => {
      // Picked only once the gate is open, so a window is never used up during a cooldown.
      const glance = this.#lookout.pick(windows, exclusions);
      if (glance === null) return null;
      const text = await this.#readEnd(glance.window);
      if (text === null) return null;
      return { reason: { kind: glance.why, window: glance.window, text }, window: glance.window };
    });
  }

  /** The idle time and titles, once a minute while nudges are on: long-stretch. */
  async observeActivity(params: {
    idleMs: number;
    windows: readonly WindowEntry[];
  }): Promise<void> {
    if (!this.#o.settings().wellbeing.enabled) {
      this.settle();
      return;
    }
    const now = this.#o.clock.now();
    const reading = this.#active.observe(params.idleMs, now, (this.#o.hourOf ?? localHour)(now));
    this.#activeMs = reading.activeMs;
    if (reading.brokeOff) this.#rest();
    const due = reading.due;
    if (due === null) return;
    const front = params.windows.find((window) => window.state === 'foreground') ?? null;
    await this.#wake('long-stretch', params.windows, () => {
      this.#active.consume(due, now);
      return Promise.resolve({
        reason: { kind: 'long-stretch', activeMs: reading.activeMs, late: due === 'late', front },
        front,
      });
    });
  }

  /** An expert's hand-off came back. Only a chain's last step checks in. */
  async finished(params: HandoffFinishedParams): Promise<void> {
    if (params.next !== undefined) return;
    await this.#wake('finished', undefined, () => {
      const handoff = this.#o.handoff(params.handoffId);
      return Promise.resolve({
        reason: {
          kind: 'finished',
          expertName: handoff?.expertName ?? 'An expert',
          ask: handoff?.ask ?? '',
          state: params.state,
          text: params.text,
          error: params.error,
        },
        handoffId: params.handoffId,
      });
    });
  }

  /** "Not now": unprompted check-ins wait an hour. A finished hand-off still comes. */
  notNow(): Date {
    this.#quietUntil = this.#o.clock.now() + NOT_NOW_MS;
    return new Date(this.#quietUntil);
  }

  /** The person took an offer: its brief goes to the hand-off card, unsent. */
  async accept(remarkId: string): Promise<boolean> {
    const offer = this.#offer;
    if (offer === null || offer.remarkId !== remarkId) return false;
    const expert = this.#o
      .experts()
      .find((candidate) => candidate.enabled && candidate.id === offer.expertId);
    if (expert === undefined) return false;
    this.#offer = null;
    // Read now, on the click, and never before: the end of the window, secrets hidden.
    const windowText = offer.window === undefined ? null : await this.#readEnd(offer.window);
    const brief: Brief =
      windowText === null || windowText === ''
        ? offer.brief
        : { ...offer.brief, context: { ...offer.brief.context, windowText } };
    this.#o.propose({
      expertId: expert.id,
      petId: offer.petId,
      brief,
      ...(offer.projectHint === undefined ? {} : { projectHint: offer.projectHint }),
    });
    return true;
  }

  /** Nudges switched off: a tired face clears at once, and the stretch starts over. */
  settle(): void {
    this.#active.reset();
    this.#activeMs = null;
    this.#rest();
  }

  /**
   * The one gate, then the one call. Each reason's own switch is checked where it comes in
   * (finished has none). Then the first failure wins and nothing is emitted: a pet, the
   * budget, one in flight, the daily cap, Not now and the cooldown (unprompted reasons
   * only), a call or full-screen app in front. `find` runs only past all of that, and may
   * still find nothing to ask about.
   */
  async #wake(
    kind: Kind,
    list: readonly WindowEntry[] | undefined,
    find: () => Promise<Wake | null>,
  ): Promise<void> {
    const settings = this.#o.settings();
    const pet = this.#o.pet();
    if (pet === null || this.#o.spentOut() || this.#busy) return;
    const now = this.#o.clock.now();
    const day = (this.#o.dayOf ?? localDay)(now);
    if (this.#day.key !== day) this.#day = { key: day, calls: 0 };
    if (this.#day.calls >= CHECK_IN_DAILY_CAP) return;
    const unprompted = kind !== 'finished';
    if (unprompted && (now < this.#quietUntil || now - this.#lastUnpromptedAt < COOLDOWN_MS)) {
      return;
    }

    this.#busy = true;
    try {
      const windows = list ?? (await this.#o.windows());
      if (windows !== null && callOrFullScreenInFront(windows)) return;
      const wake = await find();
      if (wake === null) return;
      this.#day.calls += 1;
      if (unprompted) this.#lastUnpromptedAt = now;
      const reply = await askMind({
        pet,
        summarizer: settings.summarizer,
        provider: this.#o.provider,
        system: `${soul()}\n\n${CHECK_IN_INSTRUCTIONS}`,
        bundle: this.#bundle(wake, settings),
        timeoutMs: this.#o.timeoutMs ?? CHECK_IN_TIMEOUT_MS,
        ...(this.#o.log === undefined ? {} : { log: this.#o.log }),
      });
      if (reply === null) return;
      // Not now may have been pressed, or the pet gone, while the mind was writing.
      if (unprompted && this.#o.clock.now() < this.#quietUntil) return;
      const speaker = this.#o.pet();
      if (speaker === null) return;
      this.#deliver(speaker, wake, reply);
    } catch (error) {
      // A store closed under it (quit), a source that throws: silence, never a crash.
      this.#o.log?.(`check-in: ${String(error)}`);
    } finally {
      this.#busy = false;
    }
  }

  #bundle(wake: Wake, settings: Settings): string {
    const pet = this.#o.pet();
    return renderBundle({
      reason: wake.reason,
      now: gatherNow(this.#o.now, pet?.id ?? '', { kind: 'check-in' }),
      memories: safe(() => this.#o.memories(), []),
      userName: settings.userName,
      lastExchange: safe(() => this.#o.lastExchange(), null),
      activeMs: settings.wellbeing.enabled ? this.#activeMs : null,
      experts: this.#o.experts(),
      recent: this.#recent,
      exclusions: settings.captureExclusions,
    });
  }

  #deliver(pet: Pet, wake: Wake, reply: CheckInReply): void {
    if (reply.mood === 'tired') {
      if (this.#o.settings().wellbeing.enabled) {
        this.#tired = true;
        this.#mood(pet.id, 'tired');
      }
    } else if (reply.mood !== undefined) {
      this.#mood(pet.id, reply.mood);
    }
    if (reply.text === undefined) return;

    this.#recent.push(reply.text);
    if (this.#recent.length > RECENT_LINES) this.#recent.shift();
    const remarkId = randomUUID();
    if (wake.handoffId !== undefined) {
      this.#offer = null;
      this.#o.emit({
        method: 'pet.remark',
        params: { remarkId, petId: pet.id, text: reply.text, handoffId: wake.handoffId },
      });
      return;
    }
    const expert = reply.offer === undefined ? undefined : this.#expertFor(reply.expertId);
    this.#offer =
      reply.offer === undefined || expert === undefined
        ? null
        : this.#makeOffer(remarkId, pet.id, expert.id, reply.offer, wake);
    this.#o.emit({
      method: 'pet.remark',
      params: {
        remarkId,
        petId: pet.id,
        text: reply.text,
        ...(this.#offer === null ? {} : { offer: this.#offer.brief.ask }),
      },
    });
  }

  /** The expert the mind named, if it is on; else the only one on; else none (no guessing). */
  #expertFor(expertId: string | undefined): Expert | undefined {
    const enabled = this.#o.experts().filter((expert) => expert.enabled);
    const named = enabled.find((expert) => expert.id === expertId);
    if (named !== undefined) return named;
    return enabled.length === 1 ? enabled[0] : undefined;
  }

  #makeOffer(remarkId: string, petId: string, expertId: string, ask: string, wake: Wake): Offer {
    const about = wake.window ?? wake.front ?? null;
    const exclusions = this.#o.settings().captureExclusions;
    // A blind spot's app and title never go into a brief.
    const context =
      about === null || blind(about, exclusions)
        ? undefined
        : { app: about.processName.replace(/\.exe$/i, ''), windowTitle: about.title };
    const offer: Offer = {
      remarkId,
      petId,
      expertId,
      brief: { ask, ...(context === undefined ? {} : { context }) },
    };
    if (wake.window !== undefined) {
      const clean = this.#lookout.lastClean();
      offer.window = wake.window;
      offer.projectHint =
        clean === null || clean === wake.window.title
          ? wake.window.title
          : `${wake.window.title} - ${clean}`;
    }
    return offer;
  }

  /** The window's last lines, through the same recorded hosts; null when it cannot be read. */
  async #readEnd(window: WindowEntry): Promise<string | null> {
    const host = this.#o
      .hosts()
      .find((h) => h.capabilities.includes('textLayer') && typeof h.readText === 'function');
    if (host === undefined) return null;
    try {
      const reading = await host.readText!({ windowId: window.id, maxChars: WINDOW_TEXT_CHARS });
      if (reading.blocked !== undefined) return null;
      return hideSecrets(reading.text).slice(-WINDOW_TEXT_CHARS).trim();
    } catch (error) {
      this.#o.log?.(`check-in: reading a window failed: ${String(error)}`);
      return null;
    }
  }

  #rest(): void {
    if (!this.#tired) return;
    this.#tired = false;
    const pet = this.#o.pet();
    if (pet !== null) this.#mood(pet.id, 'rested');
  }

  #mood(petId: string, mood: PetMoodParams['mood']): void {
    this.#o.emit({ method: 'pet.mood', params: { petId, mood } });
  }
}

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
