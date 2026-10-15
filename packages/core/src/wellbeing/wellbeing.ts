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
import { blind, callOrFullScreenInFront } from '../keep-an-eye/lookout';

/**
 * Gentle nudges. The host sends the idle time and the window titles once a minute; this
 * class decides, from those and the clock alone, when Scout looks tired and says one fixed
 * line. No screen is read and no model is asked, so a nudge costs nothing.
 */

/** Unbroken activity this long, and Scout suggests a stretch. */
export const STRETCH_MS = 90 * 60_000;
/** An idle gap this long is a break: the stretch starts over and Scout looks rested. */
export const BREAK_MS = 5 * 60_000;
/** Late at night, this much activity before Scout says it is late. */
export const LATE_ACTIVE_MS = 30 * 60_000;
/** Late night runs from this hour... */
export const LATE_FROM_HOUR = 23;
/** ...to this one, when the tired face clears. */
export const LATE_UNTIL_HOUR = 5;
/** How long "Not now" keeps the nudges quiet. */
export const NOT_NOW_MS = 60 * 60_000;
/** Two late lines closer than this are the same night (late night is six hours long). */
const SAME_NIGHT_MS = 12 * 60 * 60_000;

export const STRETCH_LINE = "You've been at it for an hour and a half. Stretch?";
export const LATE_LINE = "It's late. Want me to write up where you are?";
/** The late-night offer's brief: the enabled expert writes the note, not Scout. */
export const WRITE_UP_ASK = 'Write a short note of where I am so I can pick up tomorrow';

export interface WellbeingOptions {
  clock: { now(): number };
  /** The local hour (0-23) at a time; injected so tests can set the night. */
  hourOf?: (now: number) => number;
  /** Read per tick, so switching it off in Settings stops the next one. */
  settings: () => Settings;
  /** The pet that speaks: the default pet. */
  pet: () => Pet | null;
  experts: () => readonly Expert[];
  /** `HandoffManager.propose`: the brief goes to the card, and nothing runs until Send. */
  propose: (params: { expertId: string; petId: string; brief: Brief }) => unknown;
  emit: (
    event:
      | { method: 'pet.remark'; params: PetRemarkParams }
      | { method: 'pet.mood'; params: PetMoodParams },
  ) => void;
}

const localHour = (now: number): number => new Date(now).getHours();

export class Wellbeing {
  readonly #options: WellbeingOptions;
  readonly #hourOf: (now: number) => number;
  /** When the current unbroken stretch began; null right after a break. */
  #activeSince: number | null = null;
  /** Whether this stretch has had its line. */
  #stretchSaid = false;
  #lateSaidAt = Number.NEGATIVE_INFINITY;
  #quietUntil = Number.NEGATIVE_INFINITY;
  /** Whether the host was last told Scout looks tired. */
  #tired = false;
  #offer: { remarkId: string; petId: string; brief: Brief } | null = null;

  constructor(options: WellbeingOptions) {
    this.#options = options;
    this.#hourOf = options.hourOf ?? localHour;
  }

  /** One host tick: the idle time and what is open, titles only. */
  observe(params: { idleMs: number; windows: readonly WindowEntry[] }): void {
    const settings = this.#options.settings();
    if (!settings.wellbeing.enabled) {
      this.settle();
      return;
    }
    const now = this.#options.clock.now();
    if (params.idleMs >= BREAK_MS) {
      this.#activeSince = null;
      this.#stretchSaid = false;
    } else {
      this.#activeSince ??= now;
    }
    const active = this.#activeSince === null ? 0 : now - this.#activeSince;
    const hour = this.#hourOf(now);
    const lateHour = hour >= LATE_FROM_HOUR || hour < LATE_UNTIL_HOUR;
    const late = lateHour && active >= LATE_ACTIVE_MS;
    const stretch = active >= STRETCH_MS;

    // The same rule as keeping an eye and Always listening: nothing changes on screen during
    // a call or over a full-screen app. What is due is given on a later tick.
    if (callOrFullScreenInFront(params.windows)) return;
    const pet = this.#options.pet();
    if (pet === null) return;

    const tired = late || stretch;
    if (tired !== this.#tired) {
      this.#tired = tired;
      this.#mood(pet.id, tired ? 'tired' : 'rested');
    }
    if (!tired || now < this.#quietUntil) return;

    if (late && now - this.#lateSaidAt >= SAME_NIGHT_MS) {
      this.#lateSaidAt = now;
      // One line at a time: a late line also counts for this stretch.
      this.#stretchSaid = true;
      this.#sayLate(pet, params.windows, settings);
      return;
    }
    if (stretch && !this.#stretchSaid) {
      this.#stretchSaid = true;
      this.#say(pet.id, STRETCH_LINE);
    }
  }

  /** Switched off: a tired face clears at once, so it never outlives the setting. */
  settle(): void {
    if (!this.#tired) return;
    this.#tired = false;
    this.#activeSince = null;
    this.#stretchSaid = false;
    const pet = this.#options.pet();
    if (pet !== null) this.#mood(pet.id, 'rested');
  }

  /** "Not now": quiet for an hour. */
  notNow(): void {
    this.#quietUntil = this.#options.clock.now() + NOT_NOW_MS;
  }

  /** The person took the late-night offer: the write-up brief goes to the card, unsent. */
  accept(remarkId: string): boolean {
    const offer = this.#offer;
    if (offer === null || offer.remarkId !== remarkId) return false;
    const expert = this.#options.experts().find((candidate) => candidate.enabled);
    if (expert === undefined) return false;
    this.#offer = null;
    this.#options.propose({ expertId: expert.id, petId: offer.petId, brief: offer.brief });
    return true;
  }

  #sayLate(pet: Pet, windows: readonly WindowEntry[], settings: Settings): void {
    const remarkId = randomUUID();
    const canHandOff = this.#options.experts().some((expert) => expert.enabled);
    if (!canHandOff) {
      this.#offer = null;
      this.#emitRemark({ remarkId, petId: pet.id, text: LATE_LINE });
      return;
    }
    const front = windows.find((window) => window.state === 'foreground');
    // A blind spot's title never goes into a brief.
    const context =
      front === undefined || blind(front, settings.captureExclusions)
        ? undefined
        : { app: front.processName.replace(/\.exe$/i, ''), windowTitle: front.title };
    this.#offer = {
      remarkId,
      petId: pet.id,
      brief: { ask: WRITE_UP_ASK, ...(context === undefined ? {} : { context }) },
    };
    this.#emitRemark({ remarkId, petId: pet.id, text: LATE_LINE, offer: WRITE_UP_ASK });
  }

  #say(petId: string, text: string): void {
    this.#offer = null;
    this.#emitRemark({ remarkId: randomUUID(), petId, text });
  }

  #emitRemark(params: PetRemarkParams): void {
    this.#options.emit({ method: 'pet.remark', params });
  }

  #mood(petId: string, mood: PetMoodParams['mood']): void {
    this.#options.emit({ method: 'pet.mood', params: { petId, mood } });
  }
}
