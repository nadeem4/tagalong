/**
 * "Scout, what's wrong?": the health check as pure functions. Turns the facts a host read
 * into one row per check and a headline. Contains HealthFacts, HealthRow, HealthCheckId,
 * FixTarget, healthRows and healthHeadline.
 */

import type { ConnectionStatus, FixTarget, MouthId } from '@tagalong/protocol';

/** Where a Fix it button lands; the type lives in protocol, beside the status marks. */
export type { FixTarget };

/**
 * What the health check read, from calls the host already makes. Each is `unknown` when its
 * call failed. Never a key or a secret: only whether one is stored.
 */
export interface HealthFacts {
  brain: 'ready' | 'signed-out' | 'no-sign-in' | 'no-key' | 'unknown';
  connections: readonly { name: string; status: ConnectionStatus }[] | 'unknown';
  voice:
    | {
        enabled: boolean;
        mouth: MouthId;
        /** Whether an ElevenLabs key is stored. */
        elevenLabsKey: boolean;
        /** Whether the local voice's model is downloaded. */
        mouthReady: boolean;
        /** Whether listening or Talk to Scout is in use, so the ears matter. */
        earsUsed: boolean;
        earsReady: boolean;
      }
    | 'unknown';
  microphone: { count: number; pickedMissing: boolean } | 'unknown';
}

export type HealthCheckId = 'brain' | 'connections' | 'voice' | 'microphone';

/** `info` and `unknown` rows are never counted as needing the person. */
export interface HealthRow {
  id: HealthCheckId;
  label: string;
  state: 'ok' | 'broken' | 'info' | 'unknown';
  line: string;
  fix?: FixTarget;
}

const UNKNOWN = 'Not checked.';

const LABELS: Record<HealthCheckId, string> = {
  brain: 'Brain',
  connections: 'Connections',
  voice: 'Voice',
  microphone: 'Microphone',
};

const make = (
  id: HealthCheckId,
  state: HealthRow['state'],
  line: string,
  fix?: FixTarget,
): HealthRow => ({
  id,
  label: LABELS[id],
  state,
  line,
  ...(fix !== undefined && (state === 'broken' || state === 'info') ? { fix } : {}),
});

function brainRow(brain: HealthFacts['brain']): HealthRow {
  switch (brain) {
    case 'ready':
      return make('brain', 'ok', 'Ready.');
    case 'signed-out':
      return make('brain', 'broken', 'Signed out of Claude.', 'brain');
    case 'no-sign-in':
      return make('brain', 'broken', 'Claude Code isn’t on this computer.', 'brain');
    case 'no-key':
      return make('brain', 'broken', 'No API key.', 'brain');
    default:
      return make('brain', 'unknown', UNKNOWN);
  }
}

function connectionsRow(connections: HealthFacts['connections']): HealthRow {
  if (connections === 'unknown') return make('connections', 'unknown', UNKNOWN);
  const problems = connections.flatMap((connection) =>
    connection.status === 'needs-sign-in'
      ? [`${connection.name} needs you to sign in again.`]
      : connection.status === 'error'
        ? [`${connection.name} isn’t working.`]
        : [],
  );
  if (problems.length > 0) return make('connections', 'broken', problems.join(' '), 'connections');
  return make(
    'connections',
    'ok',
    connections.length === 0 ? 'No apps connected.' : 'All apps connected.',
  );
}

function voiceRow(voice: HealthFacts['voice']): HealthRow {
  if (voice === 'unknown') return make('voice', 'unknown', UNKNOWN);
  const problems: string[] = [];
  if (voice.enabled && voice.mouth === 'elevenlabs' && !voice.elevenLabsKey) {
    problems.push('The ElevenLabs voice has no key.');
  }
  if (voice.earsUsed && !voice.earsReady) problems.push('Speech model not downloaded.');
  if (problems.length > 0) return make('voice', 'broken', problems.join(' '), 'voice');
  if (!voice.enabled) return make('voice', 'info', 'Voice is off.', 'voice');
  if (voice.mouth === 'kokoro' && !voice.mouthReady) {
    return make('voice', 'ok', 'Voice downloads on first use.');
  }
  return make('voice', 'ok', 'Ready.');
}

function microphoneRow(microphone: HealthFacts['microphone']): HealthRow {
  if (microphone === 'unknown') return make('microphone', 'unknown', UNKNOWN);
  if (microphone.pickedMissing) {
    return make('microphone', 'broken', 'The one you picked is unplugged.', 'voice');
  }
  if (microphone.count === 0) return make('microphone', 'broken', 'No microphone found.', 'voice');
  return make('microphone', 'ok', 'A microphone is ready.');
}

/** One row per check, in the card's order. Pure: no call, no model. */
export function healthRows(facts: HealthFacts): HealthRow[] {
  return [
    brainRow(facts.brain),
    connectionsRow(facts.connections),
    voiceRow(facts.voice),
    microphoneRow(facts.microphone),
  ];
}

const COUNT = ['One', 'Two', 'Three', 'Four'];

/** The card's first line, and the only one said aloud (only when the question was spoken). */
export function healthHeadline(rows: readonly HealthRow[]): string {
  const broken = rows.filter((row) => row.state === 'broken').length;
  if (broken === 0) return 'Everything’s working.';
  const count = COUNT[broken - 1] ?? String(broken);
  return broken === 1 ? `${count} thing needs you.` : `${count} things need you.`;
}
