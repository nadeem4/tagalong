import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extensionFolder, isAllowedLink } from './links';

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

describe('extensionFolder', () => {
  const exists = (paths: string[]) => (path: string) => paths.includes(path);

  it('points a packaged app at the extension shipped in its resources', () => {
    expect(
      extensionFolder({
        packaged: true,
        resourcesPath: '/opt/Tagalong/resources',
        appPath: '/opt/Tagalong/resources/app.asar',
        exists: exists([join('/opt/Tagalong/resources', 'extension')]),
      }),
    ).toBe(join('/opt/Tagalong/resources', 'extension'));
  });

  // Built with node:path so the expectations hold on the Windows CI runner too.
  it('points a source checkout at the extension build', () => {
    expect(
      extensionFolder({
        packaged: false,
        resourcesPath: '/irrelevant',
        appPath: '/repo/apps/desktop',
        exists: exists([resolve('/repo/apps/extension/dist')]),
      }),
    ).toBe(resolve('/repo/apps/extension/dist'));
  });

  it('says nothing when the extension was never built', () => {
    expect(
      extensionFolder({
        packaged: false,
        resourcesPath: '/irrelevant',
        appPath: '/repo/apps/desktop',
        exists: exists([]),
      }),
    ).toBeUndefined();
  });
});
