/**
 * Claude Code, Codex and Cursor as Scout can connect them: their names, the line or block each
 * takes to add Scout's memory by hand, and what an outside memory's source reads as. React-free.
 * Contains AI_TOOLS, howToLines, memorySourceLabel and the connect result shapes.
 */

export type AiToolId = 'claude-code' | 'codex' | 'cursor';

export const AI_TOOLS: readonly { id: AiToolId; label: string; file: string }[] = [
  { id: 'claude-code', label: 'Claude Code', file: '~/.claude.json' },
  { id: 'codex', label: 'Codex', file: '~/.codex/config.toml' },
  { id: 'cursor', label: 'Cursor', file: '~/.cursor/mcp.json' },
];

/** How `connect_ai_tool` ended: the brain's sentence, or the reason it gave. */
export type AiToolConnect = { ok: true; text: string } | { ok: false; message: string };

/** One pairing link the brain made for an AI tool, and when it stops working (ISO, UTC). */
export interface AiToolLink {
  link: string;
  expiresAt: string;
}

const BRIDGE = 'cmd /c tagalong memory-mcp --client';

/** The by-hand steps: `add` goes to the tool, `pair` redeems the link on the PC that runs it. */
export function howToLines(
  tool: AiToolId,
  link: string,
): { where: string | null; add: string; pair: string } {
  const pair = `tagalong memory-mcp --pair ${link} --client ${tool}`;
  if (tool === 'claude-code') {
    return { where: null, add: `claude mcp add --scope user tagalong -- ${BRIDGE} ${tool}`, pair };
  }
  if (tool === 'codex') {
    return { where: null, add: `codex mcp add tagalong -- ${BRIDGE} ${tool}`, pair };
  }
  const entry = {
    mcpServers: {
      tagalong: { command: 'cmd', args: ['/c', 'tagalong', 'memory-mcp', '--client', tool] },
    },
  };
  return { where: '~/.cursor/mcp.json', add: JSON.stringify(entry, null, 2), pair };
}

/** The tool an outside memory came from (`mcp:<name>`), in words; null for any other source. */
export function memorySourceLabel(source: string): string | null {
  if (!source.startsWith('mcp:')) return null;
  const name = source.slice('mcp:'.length);
  return AI_TOOLS.find((tool) => tool.id === name)?.label ?? name;
}
