/**
 * When the first-run walkthrough opens and when the pets may show. It opens at every launch
 * until finished or skipped (no brain needed), and the pet, bubble and dock stay hidden while
 * its window is open. Contains shouldOpenWalkthrough and petsVisible.
 */

/** Whether launch should open the walkthrough: until Finish or Skip marks it done. */
export function shouldOpenWalkthrough(settings: { walkthrough: { done: boolean } }): boolean {
  return !settings.walkthrough.done;
}

/** Whether the pet, bubble and dock may show. Closing the window part-way brings them back. */
export function petsVisible(state: { walkthroughOpen: boolean }): boolean {
  return !state.walkthroughOpen;
}
