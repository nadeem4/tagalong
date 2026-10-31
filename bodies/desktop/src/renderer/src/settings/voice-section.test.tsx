/**
 * Tests for the Voice section's speed slider: every voice goes up to 1.3.
 * Static render only (no DOM in this suite); switching voices live is a manual check.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SETTINGS_DEFAULTS } from '../../../shared/settings';
import type { Settings } from '../../../shared/settings';

import { VoiceSection } from './voice-section';

function slider(voice: Partial<Settings['voice']>): { max: string; value: string } {
  const html = renderToStaticMarkup(
    <VoiceSection
      settings={{ ...SETTINGS_DEFAULTS, voice: { ...SETTINGS_DEFAULTS.voice, ...voice } }}
    />,
  );
  const tag = /<input[^>]*name="voiceSpeed"[^>]*>/.exec(html)![0];
  return { max: /max="([^"]*)"/.exec(tag)![1]!, value: /value="([^"]*)"/.exec(tag)![1]! };
}

describe('VoiceSection speed slider', () => {
  it('keeps a saved 1.3 for each voice', () => {
    expect(slider({ mouth: 'kokoro', speed: 1.3 })).toEqual({ max: '1.3', value: '1.3' });
    expect(slider({ mouth: 'system', speed: 1.3 })).toEqual({ max: '1.3', value: '1.3' });
  });
});
