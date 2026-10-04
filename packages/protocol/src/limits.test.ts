import { describe, expect, it } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };

describe('the limits subpath', () => {
  // The extension injects code that reads these budgets into web pages, and the subpath is
  // how it gets them without zod. apps/extension holds the test that limits.ts imports nothing.
  it('is exported on its own path', () => {
    expect(packageJson.exports['./limits']).toEqual({
      types: './dist/limits.d.ts',
      default: './dist/limits.js',
    });
  });
});
