/** Tests for the talk rules: settling, partial words, and failures said once. */
import { describe, expect, it } from 'vitest';
import {
  EarsNotes,
  FIRST_TIME,
  FailureStreak,
  FollowUpCue,
  NOTHING_HEARD,
  micMark,
  micNote,
  settles,
  shownPartial,
} from './talk-rules';

describe('NOTHING_HEARD', () => {
  it('is a plain status, not Scout speaking', () => {
    expect(NOTHING_HEARD).toBe('Nothing heard.');
  });
});

describe('settles', () => {
  it('lets the bubble go quiet when no held question is being asked', () => {
    expect(settles(null)).toBe(true);
    // An always question heard, or a held one heard after always listening resumed.
    expect(settles('always')).toBe(true);
  });

  it('leaves a held question that has already started alone', () => {
    expect(settles('held')).toBe(false);
  });
});

describe('shownPartial', () => {
  it('shows an always question without the name it starts with', () => {
    expect(shownPartial('Scout, what am I looking at', 'always')).toBe('what am I looking at');
    expect(shownPartial('hey Scout what time is it', 'always')).toBe('what time is it');
  });

  it('shows the words as heard when they do not start with the name', () => {
    expect(shownPartial('what am I looking at', 'always')).toBe('what am I looking at');
    expect(shownPartial('Scout', 'always')).toBe('Scout');
  });

  it('shows a held question as said: it needs no name, so "Scout" is part of it', () => {
    expect(shownPartial('Scout, what is this', 'held')).toBe('Scout, what is this');
  });

  it('shows nothing when nothing was heard', () => {
    expect(shownPartial(null, 'always')).toBeNull();
    expect(shownPartial('', 'held')).toBeNull();
  });
});

describe('FailureStreak', () => {
  it('tells the first failure of a streak only', () => {
    const streak = new FailureStreak();
    expect(streak.fail()).toBe(true);
    expect(streak.fail()).toBe(false);
    expect(streak.fail()).toBe(false);
  });

  it('tells again once the streak is broken', () => {
    const streak = new FailureStreak();
    streak.fail();
    streak.clear();
    expect(streak.fail()).toBe(true);
  });
});

describe('EarsNotes', () => {
  const OFFLINE = 'Speech models didn’t download.';

  it('says the first-time download, and clears it once the ears are ready', () => {
    const notes = new EarsNotes();
    expect(notes.status(null, 'loading')).toBe(FIRST_TIME);
    expect(notes.status(FIRST_TIME, 'ready')).toBeNull();
    expect(notes.status('Something else', 'ready')).toBe('Something else');
  });

  it('says a failure once, not again at each always-listening retry', () => {
    const notes = new EarsNotes();
    let note = notes.status(null, 'loading');
    note = notes.failed(note, OFFLINE);
    expect(note).toBe(OFFLINE);
    // The next retry downloads again and fails again: the failure stays, said once.
    note = notes.status(note, 'loading');
    expect(note).toBe(OFFLINE);
    note = notes.failed(note, OFFLINE);
    expect(note).toBe(OFFLINE);
  });

  it('never leaves the first-time note behind after a failure', () => {
    const notes = new EarsNotes();
    notes.failed(null, OFFLINE);
    // The failure was cleared from the bubble, then a retry fails while the first-time note shows.
    expect(notes.failed(FIRST_TIME, OFFLINE)).toBeNull();
  });

  it('says a plain line when the failure has none', () => {
    expect(new EarsNotes().failed(null, undefined)).toBe('Listening stopped. Try again.');
  });

  it('clears the failure once the ears work, and tells the next one again', () => {
    const notes = new EarsNotes();
    let note = notes.failed(null, OFFLINE);
    note = notes.status(note, 'ready');
    expect(note).toBeNull();
    expect(notes.failed(note, OFFLINE)).toBe(OFFLINE);
  });

  it('tells the failure again when the person acts', () => {
    const notes = new EarsNotes();
    notes.failed(null, OFFLINE);
    notes.clear();
    expect(notes.status(null, 'loading')).toBe(FIRST_TIME);
    expect(notes.failed(FIRST_TIME, OFFLINE)).toBe(OFFLINE);
  });
});

describe('micMark', () => {
  it('names the mark on Scout: busy in another app, or not usable', () => {
    expect(micMark({ name: 'NotReadableError' })).toBe('mic-busy');
    expect(micMark({ name: 'NotFoundError' })).toBe('mic-failed');
    expect(micMark(new Error('x'))).toBe('mic-failed');
  });
});

describe('FollowUpCue', () => {
  // `update(speaking, answering)`: Scout's voice, and a spoken answer still streaming in.
  it('opens the window once, when the spoken answer to a spoken question ends', () => {
    const cue = new FollowUpCue();
    cue.asked();
    expect(cue.update(false, true)).toBe(false);
    expect(cue.update(true, true)).toBe(false);
    expect(cue.update(true, false)).toBe(false);
    expect(cue.update(false, false)).toBe(true);
    expect(cue.update(true, false)).toBe(false);
    expect(cue.update(false, false)).toBe(false);
  });

  it('waits out a streamed answer that pauses between sentences: only its very end opens it', () => {
    const cue = new FollowUpCue();
    cue.asked();
    cue.update(false, true);
    cue.update(true, true);
    // The speech queue ran dry while the next sentence is still on its way.
    expect(cue.update(false, true)).toBe(false);
    cue.update(true, true);
    cue.update(true, false);
    expect(cue.update(false, false)).toBe(true);
  });

  it('never opens for speech that answered nothing asked by voice', () => {
    const cue = new FollowUpCue();
    cue.update(true, false);
    expect(cue.update(false, false)).toBe(false);
  });

  it('never opens for an answer that said nothing, nor for a remark spoken after it', () => {
    const cue = new FollowUpCue();
    cue.asked();
    cue.update(false, true);
    // A quiet status or an error: the stream ended and nothing was said.
    expect(cue.update(false, false)).toBe(false);
    cue.update(true, false);
    expect(cue.update(false, false)).toBe(false);
  });

  it('never opens when the person cut Scout off: the stop button, the close, talking over it', () => {
    const cue = new FollowUpCue();
    cue.asked();
    cue.update(true, true);
    cue.hushed();
    expect(cue.update(false, false)).toBe(false);
  });

  it('waits for speech to start: an answer still on its way is not over', () => {
    const cue = new FollowUpCue();
    cue.asked();
    expect(cue.update(false, false)).toBe(false);
    cue.update(true, false);
    expect(cue.update(false, false)).toBe(true);
  });
});

describe('micNote', () => {
  it('says another app has the microphone when it is busy', () => {
    expect(micNote({ name: 'NotReadableError' })).toBe(
      'Another app is using the microphone. Close it and try again, or pick another in Settings.',
    );
  });

  it('says the microphone could not be opened otherwise', () => {
    expect(micNote({ name: 'NotFoundError' })).toBe(
      'The microphone could not be opened. Check that Windows lets apps use it, or pick another in Settings.',
    );
    expect(micNote(new Error('x'))).toMatch(/could not be opened/);
  });
});
