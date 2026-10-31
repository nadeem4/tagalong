/** Tests for the sender check handlers share. */

import { describe, expect, it } from 'vitest';
import { fromWindow } from './handle';

describe('fromWindow', () => {
  const contents = {};
  const live = { isDestroyed: () => false, webContents: contents };

  it("accepts a call from the window's own page", () => {
    expect(fromWindow(() => live)({ sender: contents })).toBe(true);
  });

  it("refuses another window's page, however alike it looks", () => {
    expect(fromWindow(() => live)({ sender: { ...contents } })).toBe(false);
    expect(fromWindow(() => live)({})).toBe(false);
    expect(fromWindow(() => live)(null)).toBe(false);
  });

  it('refuses when the window is not there or has closed', () => {
    expect(fromWindow(() => null)({ sender: contents })).toBe(false);
    const closed = { isDestroyed: () => true, webContents: contents };
    expect(fromWindow(() => closed)({ sender: contents })).toBe(false);
  });
});
