/**
 * The system notification for a finished hand-off, and where Scout's line about one goes.
 * Contains handoffNotice and handoffLine.
 */

import type { HandoffFinishedParams, PetRemarkParams } from '@tagalong/protocol';

const PREVIEW_CHARS = 160;

/**
 * The system notification for a finished hand-off, so the answer reaches the user even with
 * Home closed. Null for one the user stopped: they already know. Null for step 1 of a chain
 * that handed on: the last step's notice is the one that tells. `name` is the expert's name;
 * left out, its id stands in.
 */
export function handoffNotice(
  params: HandoffFinishedParams,
  name?: string,
): { title: string; body: string } | null {
  const who = name ?? params.expertId;
  if (params.state === 'stopped' || params.next !== undefined) return null;
  if (params.state === 'error') {
    return { title: `${who} could not finish`, body: params.error ?? 'No reason given.' };
  }
  const text = (params.text ?? '').trim().replace(/\s+/g, ' ');
  const preview = text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;
  const changed =
    params.changedFiles && params.changedFiles.length > 0
      ? ` Changed ${params.changedFiles.join(', ')}.`
      : '';
  return { title: `${who} finished`, body: `${preview}${changed} Open Home to read it all.` };
}

/**
 * Scout's line about a finished hand-off. With the bubble open it lands on the hand-off card
 * there. With the bubble closed no card can take it, so it becomes an ordinary line beside
 * Scout (shown and said once, with the same rules as any other), rather than being lost.
 */
export function handoffLine(params: PetRemarkParams, bubbleOpen: boolean): PetRemarkParams {
  if (params.handoffId === undefined || bubbleOpen) return params;
  const { handoffId: _handoffId, ...line } = params;
  return line;
}

/**
 * Whether the panel's bubble should get a `pet.remark`. With the panel hidden a plain remark
 * is the quiet line beside Scout (main sends it separately), so the bubble, which is mounted
 * even then, must not show and say it a second time. Open, the bubble is the only place.
 */
export function bubbleHearsRemark(params: PetRemarkParams, bubbleOpen: boolean): boolean {
  return params.handoffId !== undefined || bubbleOpen;
}
