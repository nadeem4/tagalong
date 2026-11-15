/**
 * Tests for the Voice section: every voice's speed goes up to 1.3, and the microphone test is
 * off at first. Static render only (no DOM in this suite): starting, stopping and following the
 * select are covered by MicTest's tests in @tagalong/ui and by e2e/mic-meter.spec.ts.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '@tagalong/ui';
import type { HostBridge } from '@tagalong/ui';
import { SETTINGS_DEFAULTS } from '../../../shared/settings';
import type { Settings } from '../../../shared/settings';

import { VoiceSection } from './voice-section';

function slider(voice: Partial<Settings['voice']>): { max: string; value: string; saved: string } {
  const html = renderToStaticMarkup(
    <HostBridgeProvider bridge={{} as HostBridge}>
      <VoiceSection
        settings={{ ...SETTINGS_DEFAULTS, voice: { ...SETTINGS_DEFAULTS.voice, ...voice } }}
      />
    </HostBridgeProvider>,
  );
  const tag = /<input[^>]*type="range"[^>]*>/.exec(html)![0];
  const hidden = /<input[^>]*name="voiceSpeed"[^>]*>/.exec(html)![0];
  return {
    max: /max="([^"]*)"/.exec(tag)![1]!,
    value: /value="([^"]*)"/.exec(tag)![1]!,
    saved: /value="([^"]*)"/.exec(hidden)![1]!,
  };
}

describe('VoiceSection speed slider', () => {
  it('keeps a saved 1.3 for each voice', () => {
    const expected = { max: '1.3', value: '1.3', saved: '1.3' };
    expect(slider({ mouth: 'kokoro', speed: 1.3 })).toEqual(expected);
    expect(slider({ mouth: 'system', speed: 1.3 })).toEqual(expected);
  });
});

describe('VoiceSection voice card', () => {
  const html = renderToStaticMarkup(
    <HostBridgeProvider bridge={{} as HostBridge}>
      <VoiceSection settings={SETTINGS_DEFAULTS} />
    </HostBridgeProvider>,
  );

  it('shows the shared Scout voice card, loading until the brain answers', () => {
    expect(html).toContain('Scout&#x27;s voice');
    expect(html).toContain('Loading voices');
  });

  it('has no two-voice dropdown, no voice field and no Preview button', () => {
    expect(html).not.toContain('id="f-voice"');
    expect(html).not.toContain('name="voice"');
    expect(html).not.toContain('Preview');
  });

  it('names the brain voice Scout’s voice, not Kokoro', () => {
    expect(html).toContain('Scout’s voice (on the brain)');
    expect(html).not.toContain('Kokoro (on the brain)');
  });
});

describe('VoiceSection microphone test', () => {
  it('offers Test your microphone with the meter off', () => {
    const html = renderToStaticMarkup(
      <HostBridgeProvider bridge={{} as HostBridge}>
        <VoiceSection settings={SETTINGS_DEFAULTS} />
      </HostBridgeProvider>,
    );
    expect(html).toContain('Test your microphone');
    expect(html).toContain('Nothing is recorded or sent');
    expect(html).not.toContain('role="meter"');
  });
});
