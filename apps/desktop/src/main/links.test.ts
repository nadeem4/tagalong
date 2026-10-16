/** Tests for the link allowlists. */

import { describe, expect, it } from 'vitest';
import { isAllowedLink, isSignInPage } from './links';

describe('isAllowedLink', () => {
  it('opens the pages where provider keys are made', () => {
    expect(isAllowedLink('https://openrouter.ai/keys')).toBe(true);
    expect(isAllowedLink('https://tokenfactory.nebius.com/')).toBe(true);
    expect(isAllowedLink('https://console.anthropic.com/settings/keys')).toBe(true);
  });

  it('opens the exact pages Welcome links to for installing a coding agent, and no others there', () => {
    expect(isAllowedLink('https://claude.com/claude-code')).toBe(true);
    expect(isAllowedLink('https://github.com/google-gemini/gemini-cli')).toBe(true);
    expect(isAllowedLink('https://github.com/openai/codex')).toBe(true);
    expect(isAllowedLink('https://github.com/evil/repo')).toBe(false);
  });

  it('refuses anything else, so a renderer cannot make main open arbitrary URLs', () => {
    expect(isAllowedLink('https://evil.example.com/keys')).toBe(false);
    expect(isAllowedLink('http://openrouter.ai/keys')).toBe(false);
    expect(isAllowedLink('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isAllowedLink('https://openrouter.ai.evil.example.com/')).toBe(false);
    expect(isAllowedLink('not a url')).toBe(false);
  });
});

describe('isSignInPage', () => {
  it('opens a connected app’s sign-in page only over https', () => {
    expect(isSignInPage('https://mcp.notion.com/authorize?client_id=x')).toBe(true);
    expect(isSignInPage('http://evil.example/authorize')).toBe(false);
    expect(isSignInPage('file:///C:/Windows/system32/cmd.exe')).toBe(false);
    expect(isSignInPage('not a url')).toBe(false);
  });
});
