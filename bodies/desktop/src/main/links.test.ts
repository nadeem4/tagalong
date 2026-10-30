/** Tests for the link allowlists. */

import { describe, expect, it } from 'vitest';
import { isSignInPage } from './links';

describe('isSignInPage', () => {
  it('opens a connected app’s sign-in page only over https', () => {
    expect(isSignInPage('https://mcp.notion.com/authorize?client_id=x')).toBe(true);
    expect(isSignInPage('http://evil.example/authorize')).toBe(false);
    expect(isSignInPage('file:///C:/Windows/system32/cmd.exe')).toBe(false);
    expect(isSignInPage('not a url')).toBe(false);
  });
});
