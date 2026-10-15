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
import { Lookout } from './lookout';
import { MoodWatch } from './mood';
import { REMARK_TEXT_CHARS, composeRemark } from './remark';

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
  propose: (params: { expertId: string; petId: string; brief: Brief }) => unknown;
  emit: (
    event:
      | { method: 'pet.remark'; params: PetRemarkParams }
      | { method: 'pet.mood'; params: PetMoodParams },
  ) => void;
  log?: (message: string) => void;
  timeoutMs?: number;
}

/**
 * Keep an eye on things: the host sends the window list every few seconds, the `Lookout`
 * picks the rare window worth a look, and one cheap model call decides whether there is
 * anything to say. A line, when there is one, goes to the host as `pet.remark`. Before that,
 * the `MoodWatch` reads the same titles for a wince or a cheer (`pet.mood`), with no read and
 * no model call.
 */
export class KeepAnEye {
  readonly #options: KeepAnEyeOptions;
  readonly #lookout: Lookout;
  readonly #moods: MoodWatch;
  #busy = false;
  /** The latest remark's offer, until it is taken or another remark replaces it. */
  #offer: { remarkId: string; petId: string; brief: Brief } | null = null;

  constructor(options: KeepAnEyeOptions) {
    this.#options = options;
    this.#lookout = new Lookout(options.clock);
    this.#moods = new MoodWatch(options.clock);
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
    if (this.#busy) return;
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
              remarkId,
              petId: pet.id,
              brief: {
                ask: offer,
                context: {
                  app: glance.window.processName.replace(/\.exe$/i, ''),
                  windowTitle: glance.window.title,
                },
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

  /** "Not now": quiet for an hour. */
  notNow(): Date {
    return new Date(this.#lookout.notNow());
  }

  /** The person took the offer: its brief goes to the hand-off card, unsent. */
  accept(remarkId: string): boolean {
    const offer = this.#offer;
    if (offer === null || offer.remarkId !== remarkId) return false;
    const expert = this.#options.experts().find((candidate) => candidate.enabled);
    if (expert === undefined) return false;
    this.#offer = null;
    this.#options.propose({ expertId: expert.id, petId: offer.petId, brief: offer.brief });
    return true;
  }
}
