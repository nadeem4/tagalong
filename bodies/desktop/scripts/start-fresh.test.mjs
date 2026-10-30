import { describe, expect, it } from 'vitest';
import { previewArgs } from './start-fresh.mjs';

describe('start:fresh', () => {
  it('starts the app on its own data folder, as on a new install', () => {
    expect(previewArgs('/tmp/tagalong-fresh-1')).toEqual([
      'preview',
      '--',
      '--user-data-dir=/tmp/tagalong-fresh-1',
    ]);
  });
});
