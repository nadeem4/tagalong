import { describe, expect, it } from 'vitest';
import { heldUntilHeard } from './held';

describe('heldUntilHeard', () => {
  it('hands the last value that arrived before anyone listened to the first listener', () => {
    const held = heldUntilHeard<string>();
    held.arrived('overview');
    held.arrived('routines');
    const heard: string[] = [];
    held.listen((value) => heard.push(value));
    expect(heard).toEqual(['routines']);
  });

  it('passes later values straight on, and keeps nothing once heard', () => {
    const held = heldUntilHeard<string>();
    const heard: string[] = [];
    const stop = held.listen((value) => heard.push(value));
    held.arrived('settings');
    stop();
    held.listen((value) => heard.push(`again ${value}`));
    expect(heard).toEqual(['settings']);
  });
});
