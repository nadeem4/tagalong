/**
 * The check-in moment: the body notices something, and the mind decides whether it is worth
 * a word. Contains `CheckIn`, its options and the gate's limits.
 *
 * Code decides WHEN (the reasons below) and keeps every guardrail (one gate, `#wake`); the
 * mind decides IF and WHAT: a line, an offer for an expert, a face, or nothing. Nothing here
 * writes a sentence for Scout. Reasons: `launch` (the app opened, or Welcome was just
 * finished), `back` (a pick-up snapshot is ready after a long break), `settled` and
 * `trouble` (from the window titles keeping an eye sends), `long-stretch` (from the activity
 * feed gentle nudges sends) and `finished` (Scout's own jobs and expert hand-offs that came
 * back, batched by Arrivals). Any failure is silence.
 */
import { randomUUID } from 'node:crypto';
import type {
  Brief,
  Expert,
  LaunchFacts,
  Pet,
  PetMoodParams,
  PetRemarkParams,
  PickUpReadyParams,
  Settings,
  WindowEntry,
} from '@tagalong/protocol';
import type { BrainProvider } from '../providers';
import type { PerceptionHost } from '../perception';
import type { Memory } from '../memory/memories';
import { gatherNow, safe, type NowSources } from '../conversation/now';
import { hideSecrets } from '../privacy/secrets';
import { soul } from '../roles';
import { Lookout, blind, callOrFullScreenInFront } from '../keep-an-eye/lookout';
import type { PickUpReady } from '../pick-up/pick-up';
import { ActiveTime } from './active-time';
import type { Arrival } from './arrivals';
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
  /** Names of the routines that ran well since an ISO time: a launch fact. */
  routinesSince: (iso: string) => readonly string[];
  /** Runs boot found still running and closed as interrupted: a launch fact after a crash. */
  interruptedAtBoot: number;
  /** `PickUp.take()`: the ready pick-up, once, or null. Taken only once the gate is open. */
  takePickUp: () => PickUpReady | null;
  /** A line about these finished jobs was shown: `JobStore.markReported`. */
  reported?: ((jobIds: readonly string[]) => void) | undefined;
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
      | { method: 'pet.mood'; params: PetMoodParams }
      | { method: 'pickUp.ready'; params: PickUpReadyParams },
  ) => void;
  /** The daily budget gate: true stops every check-in. */
  spentOut: () => boolean;
  log?: (message: string) => void;
  timeoutMs?: number;
}

/** What a wake found to ask about, once the gate let it through. */
interface Wake {
  reason: BundleReason;
  handoffId?: string;
  /** A pick-up taken for this wake: the line, if any, rides with its card. */
  pickUp?: PickUpReady;
  /** Jobs to mark told once a line about them is shown. */
  jobIds?: readonly string[];
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
      return { reason: { kind: glance.why, window: glance.window, text } };
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
      });
    });
  }

  /**
   * The app opened (or Welcome was just finished). Exempt from the cooldown and Not now,
   * but starts the cooldown. Settings are read before the first await: the host records
   * this launch right after asking, and the facts are about the last one.
   */
  async launch(facts: LaunchFacts): Promise<void> {
    const settings = this.#o.settings();
    if (!settings.greeting) return;
    const { lastOpenedAt, lastClosedAt } = settings;
    const now = this.#o.clock.now();
    // Away since the last quit; a crash records no quit, so then since the last launch.
    const awaySince = [lastOpenedAt, lastClosedAt]
      .filter((at): at is string => at !== null)
      .map((at) => Date.parse(at))
      .reduce<number | null>((latest, at) => (latest === null || at > latest ? at : latest), null);
    const updated = facts.lastVersion !== null && facts.lastVersion !== facts.version;
    await this.#wake('launch', undefined, () => {
      const pickUp = this.#takePickUp();
      return Promise.resolve({
        reason: {
          kind: 'launch',
          welcomed: facts.welcomed === true,
          awayMs: awaySince === null ? null : now - awaySince,
          // An installer ends a running app by force: a "crash" over an update is the update.
          crashed: facts.crashed && !updated ? { cutShort: this.#o.interruptedAtBoot } : null,
          update:
            updated && facts.lastVersion !== null
              ? { from: facts.lastVersion, to: facts.version, notes: facts.releaseNotes }
              : null,
          routines:
            lastOpenedAt === null ? [] : safe(() => this.#o.routinesSince(lastOpenedAt), []),
          pickUp,
        },
        ...(pickUp === null ? {} : { pickUp }),
      });
    });
  }

  /** A pick-up is ready (back after a long break). Left in place when the gate is closed. */
  async back(): Promise<void> {
    if (!this.#o.settings().pickUp) return;
    await this.#wake('back', undefined, () => {
      const pickUp = this.#takePickUp();
      if (pickUp === null) return Promise.resolve(null);
      const awayMs = this.#o.clock.now() - pickUp.takenAt;
      return Promise.resolve({ reason: { kind: 'back', awayMs, pickUp }, pickUp });
    });
  }

  /**
   * Finished work, gathered by Arrivals: one wake for the whole batch. False only when
   * another check-in was running or a call or full screen came up, so the batch is kept and
   * tried again.
   */
  async finished(items: readonly Arrival[]): Promise<boolean> {
    const only = items.length === 1 ? items[0] : undefined;
    return this.#wake('finished', undefined, () =>
      Promise.resolve({
        reason: { kind: 'finished', items },
        ...(only?.handoffId === undefined ? {} : { handoffId: only.handoffId }),
        jobIds: items.flatMap((item) => (item.jobId === undefined ? [] : [item.jobId])),
      }),
    );
  }

  /** "Not now": unprompted check-ins wait an hour. Finished work still comes. */
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
   * budget, one in flight, the daily cap, Not now and the cooldown (not for a launch or
   * finished work), a call or full-screen app in front. `find` runs only past all of that,
   * and may still find nothing to ask about. False only for "one already in flight" and, for
   * finished work, a call or full screen in front.
   */
  async #wake(
    kind: Kind,
    list: readonly WindowEntry[] | undefined,
    find: () => Promise<Wake | null>,
  ): Promise<boolean> {
    if (this.#busy) return false;
    const settings = this.#o.settings();
    const pet = this.#o.pet();
    if (pet === null || this.#o.spentOut()) return true;
    const now = this.#o.clock.now();
    const day = (this.#o.dayOf ?? localDay)(now);
    if (this.#day.key !== day) this.#day = { key: day, calls: 0 };
    if (this.#day.calls >= CHECK_IN_DAILY_CAP) return true;
    const held = kind !== 'finished' && kind !== 'launch';
    if (held && (now < this.#quietUntil || now - this.#lastUnpromptedAt < COOLDOWN_MS)) {
      return true;
    }

    this.#busy = true;
    try {
      const windows = list ?? (await this.#o.windows());
      // Finished work is handed back, so Arrivals holds it until the call is over.
      if (windows !== null && callOrFullScreenInFront(windows)) return kind !== 'finished';
      const wake = await find();
      if (wake === null) return true;
      this.#day.calls += 1;
      // Every call but finished work's starts the cooldown, a launch's included.
      if (kind !== 'finished') this.#lastUnpromptedAt = now;
      const reply = await askMind({
        pet,
        summarizer: settings.summarizer,
        provider: this.#o.provider,
        system: `${soul()}\n\n${CHECK_IN_INSTRUCTIONS}`,
        bundle: this.#bundle(pet, wake, settings),
        timeoutMs: this.#o.timeoutMs ?? CHECK_IN_TIMEOUT_MS,
        ...(this.#o.log === undefined ? {} : { log: this.#o.log }),
      });
      if (reply === null) return true;
      // Not now may have been pressed, or the pet gone, while the mind was writing.
      if (held && this.#o.clock.now() < this.#quietUntil) return true;
      const speaker = this.#o.pet();
      if (speaker === null) return true;
      this.#deliver(speaker, wake, reply);
    } catch (error) {
      // A store closed under it (quit), a source that throws: silence, never a crash.
      this.#o.log?.(`check-in: ${String(error)}`);
    } finally {
      this.#busy = false;
    }
    return true;
  }

  #bundle(pet: Pet, wake: Wake, settings: Settings): string {
    return renderBundle({
      reason: wake.reason,
      now: gatherNow(this.#o.now, pet.id, { kind: 'check-in' }),
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
    // Silence tells nothing: what finished stays "not mentioned yet" in Now.
    if (reply.text === undefined) return;
    if (wake.jobIds !== undefined && wake.jobIds.length > 0) this.#o.reported?.(wake.jobIds);

    this.#recent.push(reply.text);
    if (this.#recent.length > RECENT_LINES) this.#recent.shift();
    if (wake.pickUp !== undefined) {
      // The line rides with the Pick up card; the card is the offer.
      this.#offer = null;
      this.#o.emit({
        method: 'pickUp.ready',
        params: { text: reply.text, items: wake.pickUp.items },
      });
      return;
    }
    const remarkId = randomUUID();
    // Finished work gets no offer; a hand-off back on its own is tied to its line.
    if (wake.reason.kind === 'finished') {
      this.#offer = null;
      this.#o.emit({
        method: 'pet.remark',
        params: {
          remarkId,
          petId: pet.id,
          text: reply.text,
          ...(wake.handoffId === undefined ? {} : { handoffId: wake.handoffId }),
        },
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
    const { reason } = wake;
    // The window a settled or trouble line is about is read again on accept; a stretch's
    // front window is context only.
    const window = reason.kind === 'settled' || reason.kind === 'trouble' ? reason.window : null;
    const about = window ?? (reason.kind === 'long-stretch' ? reason.front : null);
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
    if (window !== null) {
      const clean = this.#lookout.lastClean();
      offer.window = window;
      offer.projectHint =
        clean === null || clean === window.title ? window.title : `${window.title} - ${clean}`;
    }
    return offer;
  }

  /** The ready pick-up, when pick-up is on. A silent mind spends it: not worth a word. */
  #takePickUp(): PickUpReady | null {
    if (!this.#o.settings().pickUp) return null;
    return safe(() => this.#o.takePickUp(), null);
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
