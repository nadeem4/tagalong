/**
 * When the first-run walkthrough opens and when the pets may show. It opens at every launch
 * until finished or skipped (no brain needed), and the pet, bubble and dock stay hidden while
 * its window is open. Contains shouldOpenWalkthrough, petsVisible and createWalkthroughGate
 * (the open and close handlers, written against small interfaces so tests pass fakes).
 */

/** Whether launch should open the walkthrough: until Finish or Skip marks it done. */
export function shouldOpenWalkthrough(settings: { walkthrough: { done: boolean } }): boolean {
  return !settings.walkthrough.done;
}

/** Whether the pet, bubble and dock may show. Closing the window part-way brings them back. */
export function petsVisible(state: { walkthroughOpen: boolean }): boolean {
  return !state.walkthroughOpen;
}

interface Hideable {
  isVisible(): boolean;
  show(): void;
  hide(): void;
}

/** The walkthrough window, as the gate needs it. */
interface TourWindow {
  focus(): void;
  reloadAt(step: number): void;
  close(): void;
}

interface GateDeps {
  pet: Hideable;
  bubble: { hide(): void };
  /** Makes the window; `onClosed` must run when it goes, however it went. */
  create(step: number | undefined, onClosed: () => void): TourWindow;
}

export function createWalkthroughGate(deps: GateDeps) {
  let tour: TourWindow | null = null;

  function open(step?: number, petWasShowing = deps.pet.isVisible()): void {
    if (tour !== null) {
      if (step !== undefined) tour.reloadAt(step);
      tour.focus();
      return;
    }
    tour = deps.create(step, () => {
      tour = null;
      // Finish, Skip tour and closing part-way all bring the pet back, if it was there.
      if (petWasShowing) deps.pet.show();
    });
    deps.pet.hide();
    deps.bubble.hide();
  }

  return {
    open: (step?: number) => open(step),
    /** A launch has not shown the pet yet, but it counts as showing. */
    openAtLaunch: () => open(undefined, true),
    close: () => tour?.close(),
    isOpen: () => tour !== null,
    /** For a second launch, the tray or a hotkey while the tour is open: show it, do nothing else. */
    bringForward: () => tour?.focus(),
  };
}

export type WalkthroughGate = ReturnType<typeof createWalkthroughGate>;
