import type {
  ActivityEntry,
  ContextSnapshot,
  Expert,
  PerceptionTarget,
  Pet,
  ProjectCandidate,
  Role,
  RolesUpgradeNotice,
} from '@tagalong/protocol';
import type { AskInput, ConfirmHandoff, HostBridge, TurnEvent } from '../host-bridge';

export interface FakeHostBridge extends HostBridge {
  /** Delivers an event to every subscriber synchronously, so tests need no timers. */
  emit(event: TurnEvent): void;
  readonly asks: readonly AskInput[];
  readonly interrupts: readonly string[];
  /** Every watch id the panel asked to stop, in order. */
  readonly stoppedWatches: readonly string[];
  /** The targets of every capture() call, in order. */
  readonly captures: readonly (readonly PerceptionTarget[])[];
  /** What the next capture() resolves to; null stands in for a blocked window. */
  nextCapture: ContextSnapshot | null;
  /** How many times the roles notice was dismissed. */
  dismissedNotices: number;
  /** Home's activity, newest first; a test pushes or edits entries, then emits an event. */
  activity: ActivityEntry[];
  /** How many times the activity was listed. */
  activityReads: number;
  /** Home's experts, as saved; a test reads them back after a save. */
  experts: Expert[];
  /** Every expert id tested, in order. */
  readonly testedExperts: readonly string[];
  /** Every hand-off the person sent, dismissed or stopped, in order. */
  readonly confirmedHandoffs: readonly ConfirmHandoff[];
  readonly dismissedHandoffs: readonly string[];
  readonly cancelledHandoffs: readonly string[];
}

/**
 * Shipped from the package rather than kept in test files: the desktop host needs the
 * same bridge double to test its renderer without booting an engine.
 */
export function createFakeHostBridge(
  options: {
    pets?: Pet[];
    capture?: ContextSnapshot | null;
    roles?: Role[];
    /** What recommendModel answers; absent answers `{}`, like a provider with no tiers. */
    recommend?: (roleId: string, providerId: string) => { model?: string; visionModel?: string };
    /** The unseen roles notice; absent means none, as on a fresh install. */
    rolesNotice?: RolesUpgradeNotice | null;
    /** Home's activity, newest first. */
    activity?: ActivityEntry[];
    experts?: Expert[];
    /** What testing an expert answers; absent answers ready. */
    testExpert?: (expertId: string) => { ok: boolean; error?: string };
    /** What the folder picker answers; absent means the host has no picker. */
    pickFolder?: () => string | null;
    /** What a project search answers; absent answers nothing found. */
    searchProjects?: (query: string) => ProjectCandidate[];
  } = {},
): FakeHostBridge {
  const handlers = new Set<(event: TurnEvent) => void>();
  const asks: AskInput[] = [];
  const interrupts: string[] = [];
  const stoppedWatches: string[] = [];
  const captures: (readonly PerceptionTarget[])[] = [];
  let turnCount = 0;
  let notice = options.rolesNotice ?? null;
  const testedExperts: string[] = [];
  const confirmedHandoffs: ConfirmHandoff[] = [];
  const dismissedHandoffs: string[] = [];
  const cancelledHandoffs: string[] = [];

  const fake: FakeHostBridge = {
    asks,
    interrupts,
    stoppedWatches,
    captures,
    nextCapture: options.capture ?? null,
    ask(input) {
      asks.push(input);
      turnCount += 1;
      return Promise.resolve({ turnId: `turn-${turnCount}` });
    },
    capture(targets) {
      captures.push(targets);
      // Read off the object so a test can change the answer between captures.
      return Promise.resolve(fake.nextCapture);
    },
    interrupt(turnId) {
      interrupts.push(turnId);
      return Promise.resolve();
    },
    onTurnEvent(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    stopWatch(watchId) {
      stoppedWatches.push(watchId);
      return Promise.resolve();
    },
    listPets() {
      return Promise.resolve(options.pets ?? []);
    },
    listRoles() {
      return Promise.resolve(options.roles ?? []);
    },
    recommendModel(roleId, providerId) {
      return Promise.resolve(options.recommend?.(roleId, providerId) ?? {});
    },
    dismissedNotices: 0,
    activity: [...(options.activity ?? [])],
    activityReads: 0,
    listActivity(params = {}) {
      fake.activityReads += 1;
      const limit = params.limit ?? 30;
      const start =
        params.before === undefined
          ? 0
          : fake.activity.findIndex((entry) => entry.id === params.before) + 1;
      const entries = fake.activity.slice(start, start + limit);
      const last = entries.at(-1);
      const more = start + limit < fake.activity.length && last !== undefined;
      return Promise.resolve(more ? { entries, next: last.id } : { entries });
    },
    experts: [...(options.experts ?? [])],
    testedExperts,
    listExperts() {
      return Promise.resolve([...fake.experts]);
    },
    saveExpert(expert) {
      const index = fake.experts.findIndex((e) => e.id === expert.id);
      if (index === -1) fake.experts.push(expert);
      else fake.experts[index] = expert;
      return Promise.resolve(expert);
    },
    deleteExpert(expertId) {
      const before = fake.experts.length;
      fake.experts = fake.experts.filter((e) => e.id !== expertId);
      return Promise.resolve(fake.experts.length < before);
    },
    testExpert(expertId) {
      testedExperts.push(expertId);
      return Promise.resolve(options.testExpert?.(expertId) ?? { ok: true });
    },
    ...(options.pickFolder === undefined
      ? {}
      : { pickFolder: () => Promise.resolve(options.pickFolder?.() ?? null) }),
    confirmedHandoffs,
    dismissedHandoffs,
    cancelledHandoffs,
    confirmHandoff(params) {
      confirmedHandoffs.push(params);
      return Promise.resolve({ handoffId: `handoff-${confirmedHandoffs.length}` });
    },
    dismissHandoff(proposalId) {
      dismissedHandoffs.push(proposalId);
      return Promise.resolve();
    },
    cancelHandoff(handoffId) {
      cancelledHandoffs.push(handoffId);
      return Promise.resolve();
    },
    searchProjects(query) {
      return Promise.resolve(options.searchProjects?.(query) ?? []);
    },
    rolesNotice() {
      return Promise.resolve(notice);
    },
    dismissRolesNotice() {
      notice = null;
      fake.dismissedNotices += 1;
      return Promise.resolve();
    },
    emit(event) {
      // Copied first so a handler that unsubscribes mid-emit cannot skip its neighbours.
      for (const handler of [...handlers]) {
        handler(event);
      }
    },
  };

  return fake;
}
