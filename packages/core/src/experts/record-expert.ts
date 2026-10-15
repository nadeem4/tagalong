import type { Expert } from '@tagalong/protocol';
import type { SightRecorder } from '../memory/sight-log';
import { renderBrief, type Connector } from './connector';

type ConnectorFor = (expert: Expert, mode?: { research: boolean }) => Connector;

/**
 * Wraps the engine's `connectorFor` so each brief sent to an expert writes one "Sent to
 * expert" row to the log of what Scout saw: the expert's name and the brief's size, never
 * the brief. A `check` sends nothing and writes nothing. The hand-off code stays untouched.
 */
export function recordExpertSends(connectorFor: ConnectorFor, log: SightRecorder): ConnectorFor {
  return (expert, mode) => {
    const connector = connectorFor(expert, mode);
    return {
      check: () => connector.check(),
      send: (brief, onProgress, signal) => {
        try {
          log.record({
            kind: 'sent_to_expert',
            expertName: expert.name,
            chars: renderBrief(brief).length,
          });
        } catch (error) {
          console.warn('[sight-log] could not write a row:', error);
        }
        return connector.send(brief, onProgress, signal);
      },
    };
  };
}
