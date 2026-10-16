/**
 * Keep an eye on things: turns the host's window lists into moods, remarks and Stuck?
 * offers. Contains KeepAnEye and pickCoder.
 */
import { randomUUID } from 'node:crypto';
import type {
  Brief,
  Expert,
  Pet,
  PetMoodParams,
  PetRemarkParams,
  Settings,
  WindowEntry,
} from '@tagalong/protocol';
import type { BrainProvider } from '../providers';
import type { PerceptionHost } from '../perception';
import { hideSecrets } from '../privacy/secrets';
import { Lookout } from './lookout';
import { MoodWatch } from './mood';
import { REMARK_TEXT_CHARS, composeRemark } from './remark';
import { StuckWatch } from './stuck';

/** A remark's offer, until it is taken or another remark replaces it. */
type Offer =
  | { kind: 'remark'; remarkId: string; petId: string; brief: Brief }
  | {
      kind: 'stuck';
      remarkId: string;
      petId: string;
      expertId: string;
      window: WindowEntry;
      brief: Brief;
      projectHint: string;
    };

/** The expert an error goes to: the one named Coder, else one good at code, else the first on. */
export function pickCoder(experts: readonly Expert[]): Expert | undefined {
  const enabled = experts.filter((expert) => expert.enabled);
  return (
    enabled.find((expert) => expert.name.trim().toLowerCase() === 'coder') ??
    enabled.find((expert) => /code/i.test(expert.goodAt)) ??
    enabled[0]
  );
}

function appOf(window: WindowEntry): string {
  return window.processName.replace(/\.exe$/i, '');
}

export interface KeepAnEyeOptions {
  clock: { now(): number };
  /** Read per snapshot, so switching it off in Settings stops the next one. */
  settings: () => Settings;
  /** The pet that speaks: the default pet. */
  pet: () => Pet | null;
  hosts: () => readonly PerceptionHost[];
  /** The same guarded resolver turns use. */
  provider: (pet: Pet) => BrainProvider;
  experts: () => readonly Expert[];
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
  /** The daily budget gate (`budgetSpent`): true means today's cap is reached. */
  spentOut?: () => boolean;
  log?: (message: string) => void;
  timeoutMs?: number;
}

/**
 * Keep an eye on things: the host sends the window list every few seconds, the `Lookout`
 * picks the rare window worth a look, and one cheap model call decides whether there is
 * anything to say. A line, when there is one, goes to the host as `pet.remark`. Before that,
 * the `MoodWatch` reads the same titles for a wince or a cheer (`pet.mood`), and the
 * `StuckWatch` offers to hand an error that stayed up to an expert: a handwritten line, with
 * no read and no model call. That window is read only if the person takes the offer.
 */
export class KeepAnEye {
  readonly #options: KeepAnEyeOptions;
  readonly #lookout: Lookout;
  readonly #moods: MoodWatch;
  readonly #stuck: StuckWatch;
  #busy = false;
  #offer: Offer | null = null;

  constructor(options: KeepAnEyeOptions) {
    this.#options = options;
    this.#lookout = new Lookout(options.clock);
    this.#moods = new MoodWatch(options.clock);
    this.#stuck = new StuckWatch(options.clock);
  }

  /** Resolves once this snapshot is fully handled, which tests wait on and the engine does not. */
  async observe(windows: readonly WindowEntry[]): Promise<void> {
    const settings = this.#options.settings();
    if (!settings.keepAnEye) return;
    const mood = this.#moods.observe(windows, settings.captureExclusions);
    const moodPet = mood === null ? null : this.#options.pet();
    if (mood !== null && moodPet !== null) {
      this.#options.emit({ method: 'pet.mood', params: { petId: moodPet.id, mood } });
    }
    this.#stuckOffer(windows, settings);
    if (this.#busy) return;
    // Proactive, so it waits once today's budget is spent: nothing is read or asked.
    // Moods above call no model, so they carry on.
    if (this.#options.spentOut?.() === true) return;
    const glance = this.#lookout.observe(windows, settings.captureExclusions);
    if (glance === null) return;
    const pet = this.#options.pet();
    const host = this.#options
      .hosts()
      .find((h) => h.capabilities.includes('textLayer') && typeof h.readText === 'function');
    if (pet === null || host === undefined) return;

    this.#busy = true;
    try {
      const reading = await host.readText!({
        windowId: glance.window.id,
        maxChars: REMARK_TEXT_CHARS,
      });
      if (reading.blocked !== undefined) return;
      const remark = await composeRemark({
        pet,
        summarizer: settings.summarizer,
        provider: this.#options.provider,
        window: glance.window,
        text: reading.text,
        ...(this.#options.timeoutMs !== undefined ? { timeoutMs: this.#options.timeoutMs } : {}),
      });
      // "Not now" may have been pressed while the line was being written.
      if (remark === null || !this.#lookout.mayspeak()) return;
      this.#lookout.spoke();

      const remarkId = randomUUID();
      const canHandOff = this.#options.experts().some((expert) => expert.enabled);
      const offer = canHandOff ? remark.offer : undefined;
      this.#offer =
        offer === undefined
          ? null
          : {
              kind: 'remark',
              remarkId,
              petId: pet.id,
              brief: {
                ask: offer,
                context: { app: appOf(glance.window), windowTitle: glance.window.title },
              },
            };
      this.#options.emit({
        method: 'pet.remark',
        params: { remarkId, petId: pet.id, text: remark.text, ...(offer ? { offer } : {}) },
      });
    } catch (error) {
      this.#options.log?.(`keep an eye: a look failed: ${String(error)}`);
    } finally {
      this.#busy = false;
    }
  }

  /** An error that stayed up: one handwritten line and an offer, from titles alone. */
  #stuckOffer(windows: readonly WindowEntry[], settings: Settings): void {
    const pet = this.#options.pet();
    const expert = pickCoder(this.#options.experts());
    const ready = pet !== null && expert !== undefined;
    const stuck = this.#stuck.observe(windows, settings.captureExclusions, ready);
    if (stuck === null || !ready) return;
    const remarkId = randomUUID();
    const ask = `Fix the error in ${stuck.window.title}`;
    this.#offer = {
      kind: 'stuck',
      remarkId,
      petId: pet.id,
      expertId: expert.id,
      window: stuck.window,
      brief: { ask, context: { app: appOf(stuck.window), windowTitle: stuck.window.title } },
      projectHint: stuck.projectHint,
    };
    this.#options.emit({
      method: 'pet.remark',
      params: {
        remarkId,
        petId: pet.id,
        text: `That error’s still up. Want me to hand it to ${expert.name}?`,
        offer: ask,
      },
    });
  }

  /** "Not now": quiet for an hour. */
  notNow(): Date {
    const until = this.#lookout.notNow();
    this.#stuck.quietUntil(until);
    return new Date(until);
  }

  /** The person took the offer: its brief goes to the hand-off card, unsent. */
  async accept(remarkId: string): Promise<boolean> {
    const offer = this.#offer;
    if (offer === null || offer.remarkId !== remarkId) return false;
    const experts = this.#options.experts();
    if (offer.kind === 'remark') {
      const expert = experts.find((candidate) => candidate.enabled);
      if (expert === undefined) return false;
      this.#offer = null;
      this.#options.propose({ expertId: expert.id, petId: offer.petId, brief: offer.brief });
      return true;
    }
    const expert =
      experts.find((candidate) => candidate.enabled && candidate.id === offer.expertId) ??
      pickCoder(experts);
    if (expert === undefined) return false;
    this.#offer = null;
    // Read now, on the click, and never before: the end of the window, secrets hidden.
    const windowText = await this.#readEnd(offer.window);
    const brief: Brief =
      windowText === null
        ? offer.brief
        : { ...offer.brief, context: { ...offer.brief.context, windowText } };
    this.#options.propose({
      expertId: expert.id,
      petId: offer.petId,
      brief,
      projectHint: offer.projectHint,
    });
    return true;
  }

  /** The window's last lines, read through the same recorded hosts; null when it cannot be. */
  async #readEnd(window: WindowEntry): Promise<string | null> {
    const host = this.#options
      .hosts()
      .find((h) => h.capabilities.includes('textLayer') && typeof h.readText === 'function');
    if (host === undefined) return null;
    try {
      const reading = await host.readText!({ windowId: window.id, maxChars: REMARK_TEXT_CHARS });
      if (reading.blocked !== undefined) return null;
      const text = hideSecrets(reading.text).slice(-REMARK_TEXT_CHARS).trim();
      return text === '' ? null : text;
    } catch (error) {
      this.#options.log?.(`keep an eye: reading a stuck window failed: ${String(error)}`);
      return null;
    }
  }
}
