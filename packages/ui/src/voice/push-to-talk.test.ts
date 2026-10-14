import { describe, expect, it } from 'vitest';
import { FRESH_PRESS_MS, PushToTalk } from './push-to-talk';

describe('PushToTalk', () => {
  it('starts on the first press and stops when the key comes up', () => {
    const talk = new PushToTalk();
    expect(talk.press(0)).toBe('start');
    expect(talk.listening).toBe(true);
    expect(talk.release()).toBe('stop');
    expect(talk.listening).toBe(false);
  });

  it('treats the key repeating while held as still held', () => {
    const talk = new PushToTalk();
    talk.press(0);
    expect(talk.press(500)).toBe('none');
    expect(talk.press(530)).toBe('none');
    expect(talk.press(560)).toBe('none');
    expect(talk.listening).toBe(true);
  });

  it('stops on a fresh press when the release was missed', () => {
    const talk = new PushToTalk();
    talk.press(0);
    expect(talk.press(FRESH_PRESS_MS + 1)).toBe('stop');
    expect(talk.listening).toBe(false);
    expect(talk.press(FRESH_PRESS_MS + 2)).toBe('start');
  });

  it('ignores a key coming up when nothing is listening', () => {
    expect(new PushToTalk().release()).toBe('none');
  });

  it('toggles from the mic button, where a key coming up means nothing', () => {
    const talk = new PushToTalk();
    expect(talk.click()).toBe('start');
    expect(talk.release()).toBe('none');
    expect(talk.listening).toBe(true);
    expect(talk.click()).toBe('stop');
    expect(talk.listening).toBe(false);
  });

  it('stops on the hotkey while the mic button is listening', () => {
    const talk = new PushToTalk();
    talk.click();
    expect(talk.press(10)).toBe('stop');
  });

  it('ended while the key is held, the key repeating never starts listening again', () => {
    const talk = new PushToTalk();
    talk.press(0);
    talk.end();
    expect(talk.press(500)).toBe('none');
    expect(talk.press(530)).toBe('none');
    expect(talk.listening).toBe(false);
    // The key coming up clears it; the next press is a new question.
    expect(talk.release()).toBe('none');
    expect(talk.press(600)).toBe('start');
  });

  it('ended while held, a fresh press after a missed release starts a new question', () => {
    const talk = new PushToTalk();
    talk.press(0);
    talk.end();
    talk.press(500);
    expect(talk.press(500 + FRESH_PRESS_MS + 1)).toBe('start');
    expect(talk.listening).toBe(true);
  });

  it('ended while held, a click on the mic button starts listening', () => {
    const talk = new PushToTalk();
    talk.press(0);
    talk.end();
    expect(talk.click()).toBe('start');
    expect(talk.listening).toBe(true);
  });

  it('ended while held, the key coming up clears it at once, so a quick press starts', () => {
    const talk = new PushToTalk();
    talk.press(0);
    talk.end();
    // The bubble passes every key up on, listening or not.
    expect(talk.release()).toBe('none');
    expect(talk.press(100)).toBe('start');
  });

  it('a key coming up after the mic button is clicked changes nothing', () => {
    const talk = new PushToTalk();
    talk.click();
    expect(talk.release()).toBe('none');
    expect(talk.listening).toBe(true);
  });

  it('ended after a click, the next click or press starts at once', () => {
    const talk = new PushToTalk();
    talk.click();
    talk.end();
    expect(talk.press(10)).toBe('start');
  });

  it('can be ended from outside, after a time limit or a failure', () => {
    const talk = new PushToTalk();
    talk.press(0);
    talk.end();
    expect(talk.listening).toBe(false);
    expect(talk.release()).toBe('none');
  });
});
