import type { Expert } from '@tagalong/protocol';
import type { SightRecorder } from '../memory/sight-log';
import { renderBrief, type Connector } from './connector';

type ConnectorFor = (expert: Expert, mode?: { research: boolean }) => Connector;

/**
 * Wraps the engine's `connectorFor` so each brief sent to an expert writes one "Sent to
 * expert" row to the log of what Scout saw: the expert's name and the brief's size, never
 * the brief. Each note from the person passed on to a running expert writes one more row,
 * the same way. A `check` sends nothing and writes nothing. The hand-off code stays untouched.
 */
export function recordExpertSends(connectorFor: ConnectorFor, log: SightRecorder): ConnectorFor {
  return (expert, mode) => {
    const connector = connectorFor(expert, mode);
    const record = (chars: number) => {
      try {
        log.record({ kind: 'sent_to_expert', expertName: expert.name, chars });
      } catch (error) {
        console.warn('[sight-log] could not write a row:', error);
      }
    };
    return {
      check: () => connector.check(),
      send: (brief, onProgress, signal, notes) => {
        record(renderBrief(brief).length);
        const recorded =
          notes === undefined
            ? undefined
            : {
                take: () => {
                  const taken = notes.take();
                  for (const note of taken) record(note.length);
                  return taken;
                },
              };
        return connector.send(brief, onProgress, signal, recorded);
      },
    };
  };
}
