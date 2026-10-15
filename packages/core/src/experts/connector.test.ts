import { describe, expect, it } from 'vitest';
import { renderBrief, type Brief } from './connector';

describe('renderBrief', () => {
  it('puts the ask first, then what the user was looking at', () => {
    const brief: Brief = {
      ask: 'Why does this test fail?',
      context: { app: 'Code', windowTitle: 'runner.test.ts', selection: 'expect(a).toBe(b)' },
      files: ['packages/core/src/conversation/runner.test.ts'],
      goodAnswer: 'The cause in one paragraph and the fix.',
    };
    const text = renderBrief(brief);
    expect(text.indexOf('Why does this test fail?')).toBe(0);
    expect(text).toContain('App: Code');
    expect(text).toContain('Window: runner.test.ts');
    expect(text).toContain('expect(a).toBe(b)');
    expect(text).toContain('- packages/core/src/conversation/runner.test.ts');
    expect(text).toContain('The cause in one paragraph and the fix.');
  });

  it('puts the end of the window it was read from after what the user was looking at', () => {
    const text = renderBrief({
      ask: 'Fix the error in Build failed',
      context: { windowTitle: 'Build failed', windowText: 'FAIL parser.test.ts: no ./lexer' },
    });
    expect(text).toContain('The end of that window:\nFAIL parser.test.ts: no ./lexer');
    expect(text.indexOf('Window: Build failed')).toBeLessThan(text.indexOf('FAIL parser'));
  });

  it('leaves out the sections it has nothing for', () => {
    const text = renderBrief({ ask: 'Tidy this paragraph.' });
    expect(text).toBe('Tidy this paragraph.');
  });

  it('hides secrets in the brief before an expert sees it', () => {
    const key = 'ghp' + '_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const text = renderBrief({
      ask: 'Why is this refused?',
      context: { selection: `TOKEN=${key}` },
    });
    expect(text).not.toContain(key);
    expect(text).toContain('[hidden:');
  });
});
