/**
 * Tests for the Settings "Where Scout looks for apps" section. Static render (no DOM in this
 * suite): the view is pure, the one read the section makes is an effect.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RegistriesView } from './registries-section';

const SOURCES = {
  apps: { name: 'MCP registry', url: 'https://registry.example/mcp' },
  experts: { name: 'ACP registry', url: 'https://registry.example/acp' },
};

describe('RegistriesView', () => {
  it('shows both registries with their urls, read only', () => {
    const html = renderToStaticMarkup(<RegistriesView sources={SOURCES} />);
    expect(html).toContain('Apps: MCP registry');
    expect(html).toContain('https://registry.example/mcp');
    expect(html).toContain('Experts: ACP registry');
    expect(html).toContain('https://registry.example/acp');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<button');
  });

  it('shows one plain line when the brain is old or offline', () => {
    const html = renderToStaticMarkup(<RegistriesView sources={null} />);
    expect(html).toContain('Scout’s brain isn’t reporting its registries right now.');
    expect(html).not.toContain('Apps:');
  });
});
