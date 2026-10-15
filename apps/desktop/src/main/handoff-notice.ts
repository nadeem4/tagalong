import type { HandoffFinishedParams } from '@tagalong/protocol';

const PREVIEW_CHARS = 160;

/**
 * The system notification for a finished hand-off, so the answer reaches the user even with
 * Home closed. Null for one the user stopped: they already know. Null for step 1 of a chain
 * that handed on: the last step's notice is the one that tells.
 */
export function handoffNotice(
  params: HandoffFinishedParams,
): { title: string; body: string } | null {
  const who = params.expertId;
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
