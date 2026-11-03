/** Tests for spotting Scout's own voice in a transcript. */
import { describe, expect, it } from 'vitest';
import { echoOf } from './echo';

describe('echoOf', () => {
  it('is true when the words run on inside what is playing', () => {
    expect(echoOf('the files are sorted', 'I moved the files. The files are sorted by year.')).toBe(
      true,
    );
  });

  it('ignores case and punctuation', () => {
    expect(echoOf('The, FILES are   sorted!', 'the files are sorted by year')).toBe(true);
    expect(echoOf('files are sorted', 'The files, are: sorted — by year.')).toBe(true);
  });

  it('is false when one word differs from what is playing', () => {
    expect(echoOf('the files are deleted', 'I moved the files. The files are sorted.')).toBe(false);
  });

  it('is false when the words are all there but not in a row', () => {
    expect(echoOf('files sorted', 'The files are sorted')).toBe(false);
  });

  it('is false for empty text on either side', () => {
    expect(echoOf('', 'anything at all')).toBe(false);
    expect(echoOf('   ', 'anything at all')).toBe(false);
    expect(echoOf('two words', '')).toBe(false);
  });

  it('never calls a single word an echo, so a lone "stop" always reaches Scout', () => {
    expect(echoOf('stop', 'I will stop here')).toBe(false);
    expect(echoOf('stop', 'something else')).toBe(false);
  });
});
