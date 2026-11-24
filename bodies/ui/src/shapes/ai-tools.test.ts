/**
 * Tests for the AI tool shapes: each tool's by-hand lines and an outside memory's source label.
 */
import { describe, expect, it } from 'vitest';
import { howToLines, memorySourceLabel } from './ai-tools';

describe('howToLines', () => {
  it('gives each tool its own add step and one pairing line that holds the link', () => {
    const claude = howToLines('claude-code', 'tagalong://pair?x');
    expect(claude.add).toBe(
      'claude mcp add --scope user tagalong -- cmd /c tagalong memory-mcp --client claude-code',
    );
    expect(claude.where).toBeNull();
    expect(claude.pair).toBe('tagalong memory-mcp --pair tagalong://pair?x --client claude-code');
    expect(howToLines('codex', 'l').add).toContain('codex mcp add tagalong');
    const cursor = howToLines('cursor', 'l');
    expect(cursor.where).toBe('~/.cursor/mcp.json');
    expect(JSON.parse(cursor.add).mcpServers.tagalong.args).toContain('cursor');
  });
});

describe('memorySourceLabel', () => {
  it('names the tool behind an outside memory and leaves other sources alone', () => {
    expect(memorySourceLabel('mcp:cursor')).toBe('Cursor');
    expect(memorySourceLabel('mcp:claude-code')).toBe('Claude Code');
    expect(memorySourceLabel('mcp:Cursor at work')).toBe('Cursor at work');
    expect(memorySourceLabel('github')).toBeNull();
  });
});
