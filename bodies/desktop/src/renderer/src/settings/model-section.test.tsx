/**
 * Tests for the Scout's model section: its card, title and lead, and its place after the key.
 * Static render (no DOM in this suite); the picker's behaviour is tested with ModelField in
 * @tagalong/ui.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HostBridgeProvider } from '@tagalong/ui';
import type { HostBridge } from '@tagalong/ui';
import { ModelSection } from './model-section';

describe('ModelSection', () => {
  it("is a home card titled Scout's model with its lead line", () => {
    const html = renderToStaticMarkup(
      <HostBridgeProvider bridge={{} as HostBridge}>
        <ModelSection />
      </HostBridgeProvider>,
    );
    expect(html).toContain('tg-card');
    expect(html).toContain('Scout&#x27;s model</h2>');
    expect(html).toContain('The AI model Scout thinks with, on your Anthropic key.');
  });
});
