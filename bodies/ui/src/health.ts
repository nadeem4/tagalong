/**
 * "Scout, what's wrong?": the health check as pure functions. Turns the facts a host read
 * into one row per check and a headline. Contains HealthFacts, HealthRow, HealthCheckId,
 * FixTarget, healthRows and healthHeadline.
 */

import type { ConnectionStatus, FixTarget, MouthId } from './shapes';

/**
 * What the health check read, from calls the host already makes. Each is `unknown` when its
 * call failed. Never a key or a secret: only whether one is stored.
 */
export interface HealthFacts {
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

export type HealthCheckId = 'connections' | 'voice' | 'microphone';

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
