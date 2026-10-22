/**
 * `self_read` and `self_write`: Scout's own notes, the Self. `self_read` lists the pages or
 * reads one; `self_write` replaces a whole page, kept as a version the person can undo.
 */
import type { BrainTool } from '../../providers';
import type { SelfStore } from '../../self/store';
import { defineTool, type Tool, type ToolOutcome } from '../tool';

export const SELF_READ = 'self_read';
export const SELF_WRITE = 'self_write';

export type SelfToolDeps = Pick<SelfStore, 'list' | 'read' | 'write'>;

const READ_DEFINITION: BrainTool = {
  name: SELF_READ,
  description:
    'Your own notes, the pages you keep: you.md (who they are, their work, goals, people, how ' +
    'they like to be helped), lessons.md (what you got wrong and do differently now), ' +
    'commitments.md (what you promised to follow up on, with dates) and skills/<name>.md ' +
    '(procedures that worked). The pages already ride on every turn, skills by their first ' +
    'line; use this to read a skill in full or to list the pages.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'A page, like skills/triage-a-failing-build.md.' },
    },
    additionalProperties: false,
  },
};

const WRITE_DEFINITION: BrainTool = {
  name: SELF_WRITE,
  description:
    'Replace one page of your notes with new text: the whole page, not a line. Use it when you ' +
    'learn something lasting about them, get something wrong and change how you work, promise a ' +
    'follow-up, or work out a procedure worth reusing. Keep pages general and short; nothing ' +
    'from a single conversation that will not matter again. you.md and commitments.md change at ' +
    'once and they can undo it; a change to lessons.md or a skill is a proposal they accept or ' +
    'reject first. Empty text deletes a skill.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'you.md, lessons.md, commitments.md or skills/<lowercase-words>.md.',
      },
      text: { type: 'string', description: 'The whole new page, in Markdown.' },
      why: { type: 'string', description: 'One short sentence: why it changed.' },
    },
    required: ['path', 'text', 'why'],
    additionalProperties: false,
  },
};

function fieldsOf(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

export function selfReadTool(self: SelfToolDeps): Tool {
  return defineTool(READ_DEFINITION, 'read', (input): Promise<ToolOutcome> => {
    const { path } = fieldsOf(input);
    if (path === undefined || path === '') {
      const lines = self
        .list()
        .map(
          (page) => `- ${page.path} (${page.chars === 0 ? 'empty' : `${page.chars} characters`})`,
        );
      return Promise.resolve({ content: `Your pages:\n${lines.join('\n')}` });
    }
    if (typeof path !== 'string') {
      return Promise.resolve({ content: 'path is a page name, as text.', isError: true });
    }
    const text = self.read(path);
    if (text === null) {
      return Promise.resolve({
        content: `${path} is not a page. Pages: you.md, lessons.md, commitments.md and skills/<name>.md.`,
        isError: true,
      });
    }
    return Promise.resolve({ content: text.trim() === '' ? `${path} is empty.` : text });
  });
}

export function selfWriteTool(self: SelfToolDeps): Tool {
  return defineTool(WRITE_DEFINITION, 'write', (input, ctx): Promise<ToolOutcome> => {
    const { path, text, why } = fieldsOf(input);
    if (typeof path !== 'string' || typeof text !== 'string' || typeof why !== 'string') {
      return Promise.resolve({
        content: 'self_write needs path, text and why, each as text.',
        isError: true,
      });
    }
    try {
      const result = self.write(path, text, { author: 'scout', why, ref: ctx.turnId });
      if (!result.ok) return Promise.resolve({ content: result.reason, isError: true });
      if (result.proposed) {
        return Promise.resolve({
          content:
            `Proposed ${path}: it is not in your notes until they accept it in What Scout ` +
            'learned, in Home. One proposal is enough.',
        });
      }
      return Promise.resolve({
        content:
          text.trim() === '' ? `Emptied ${path}.` : `Saved ${path} (${text.length} characters).`,
      });
    } catch (error) {
      return Promise.resolve({
        content: `The notes could not be saved: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      });
    }
  });
}
