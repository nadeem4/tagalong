import type { Role } from '@tagalong/protocol';

/** Two small roles for tests that need a role library without the engine's. */
export const FIXTURE_ROLES: readonly Role[] = [
  {
    id: 'generalist',
    name: 'Generalist',
    version: 1,
    summary: 'Explains, summarises and answers anything.',
    goodAt: ['explaining', 'summaries'],
    notFor: ['deep specialist work'],
    tools: ['look_at_screen', 'remember', 'ask_pet'],
    model: { tier: 'balanced', needsVision: true },
    instructions: 'You are a generalist.',
  },
  {
    id: 'backend-engineer',
    name: 'Backend engineer',
    version: 2,
    summary: 'Fixes servers, databases and broken builds.',
    goodAt: ['APIs', 'databases'],
    notFor: ['visual design'],
    tools: ['read_window_text', 'watch_for', 'remember'],
    model: { tier: 'deep', needsVision: false },
    instructions: 'You are a backend engineer.',
  },
];
