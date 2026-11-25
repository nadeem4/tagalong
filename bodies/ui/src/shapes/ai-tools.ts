/**
 * Claude Code, Codex and Cursor as Scout can connect them: their names, the line or block each
 * takes to add Scout's memory by hand, and what an outside memory's source reads as. React-free.
 * Contains AI_TOOLS, aiToolLabel, expertName, bridgeArgv, howToLines, isOutsideSource, memorySourceLabel and the connect result shapes.
 */

export type AiToolId = 'claude-code' | 'codex' | 'cursor';

export const AI_TOOLS: readonly { id: AiToolId; label: string; file: string }[] = [
  { id: 'claude-code', label: 'Claude Code', file: '~/.claude.json' },
  { id: 'codex', label: 'Codex', file: '~/.codex/config.toml' },
  { id: 'cursor', label: 'Cursor', file: '~/.cursor/mcp.json' },
];

/** How `connect_ai_tool` ended: the brain's sentence, or the reason it gave. */
export type AiToolConnect = { ok: true; text: string } | { ok: false; message: string };

/** One pairing link made for an AI tool, or why none could be: the network is off, or anything else. */
export type AiToolLinkResult =
  { ok: true; link: string } | { ok: false; reason: 'network_off' | 'failed' };

/** What an AI tool starts to reach Scout's memory; `cmd /c` because Windows tools cannot start the `.cmd` that puts `tagalong` on the path. */
export const bridgeArgv = (tool: string): string[] => [
  'cmd',
  '/c',
  'tagalong',
  'memory-mcp',
  '--client',
  tool,
];

/** The by-hand steps: `add` goes to the tool, `pair` redeems the link on the PC that runs it. */
export function howToLines(
  tool: AiToolId,
  link: string,
): { where: string | null; add: string; pair: string } {
  const pair = `tagalong memory-mcp --pair ${link} --client ${tool}`;
  const bridge = bridgeArgv(tool);
  if (tool === 'claude-code') {
    return {
      where: null,
      add: `claude mcp add --scope user tagalong -- ${bridge.join(' ')}`,
      pair,
    };
  }
  if (tool === 'codex') {
    return { where: null, add: `codex mcp add tagalong -- ${bridge.join(' ')}`, pair };
  }
  const entry = { mcpServers: { tagalong: { command: bridge[0], args: bridge.slice(1) } } };
  return {
    where: AI_TOOLS.find((t) => t.id === tool)!.file,
    add: JSON.stringify(entry, null, 2),
    pair,
  };
}

/** True for a memory another AI tool wrote (`mcp:<name>`): the brain's own rule, read here for display. */
export const isOutsideSource = (source: string): boolean => source.startsWith('mcp:');

/** The tool an outside memory came from, in words; null for any other source. */
export function memorySourceLabel(source: string): string | null {
  if (!isOutsideSource(source)) return null;
  return aiToolLabel(source.slice('mcp:'.length));
}

/** A tool's id in words ("claude-code" reads "Claude Code"); a name it does not know stays as given. */
export const aiToolLabel = (name: string): string =>
  AI_TOOLS.find((tool) => tool.id === name)?.label ?? name;

/** An expert's id in words: `claude-code` reads "Claude Code"; an id the app does not know is title-cased. */
export const expertName = (id: string | undefined): string => {
  if (id === undefined) return 'The expert';
  return AI_TOOLS.some((tool) => tool.id === id)
    ? aiToolLabel(id)
    : id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};
