import { describe, expect, it, vi } from 'vitest';
import { homeTarget, scrollToSection } from './home-target';

describe('homeTarget', () => {
  it('reads a plain page', () => {
    expect(homeTarget('experts')).toEqual({ page: 'experts' });
    expect(homeTarget('settings')).toEqual({ page: 'settings' });
  });

  it('reads settings#voice as the Settings page at its Voice section', () => {
    expect(homeTarget('settings#voice')).toEqual({ page: 'settings', section: 'voice' });
  });

  it('ignores a section on any page but Settings', () => {
    expect(homeTarget('experts#voice')).toEqual({ page: 'experts' });
  });
});

describe('scrollToSection', () => {
  it('scrolls the named section into view once it is on the page', () => {
    const section = { scrollIntoView: vi.fn() };
    const doc = { getElementById: vi.fn(() => section) };
    expect(scrollToSection(doc, 'voice')).toBe(true);
    expect(doc.getElementById).toHaveBeenCalledWith('voice');
    expect(section.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('says so when the section is not there yet', () => {
    expect(scrollToSection({ getElementById: () => null }, 'voice')).toBe(false);
  });
});
