/**
 * Test helper for tool results: `directivesIn` finds the lines a tool result speaks to the
 * model as orders ("Tell the user…", "Say…", "Do not…", "say so"). A result states facts;
 * the model decides what to say. Imported only by tests.
 */
import type { ToolOutcome } from './tool';

const DIRECTIVE = /(?:^|[.:;!?]\s+|\n)(?:Tell|Say|Ask them|Ask the|Do not|Don’t|Don't)\b[^.\n]*/g;
const SAY_SO = /\bsay so\b/gi;

/** Every order to the model in a tool result; empty when the result is facts only. */
export function directivesIn(content: ToolOutcome['content']): string[] {
  const text =
    typeof content === 'string'
      ? content
      : content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .filter((text) => text !== '')
          .join('\n');
  return [...text.matchAll(DIRECTIVE), ...text.matchAll(SAY_SO)].map((m) => m[0].trim());
}
