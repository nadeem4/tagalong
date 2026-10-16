/**
 * Test helpers for tools: `FAKE_TURN_PET`, `fakeTurn` and `fakeTurnTools`. Imported only
 * by tests.
 */
import type { Pet } from '@tagalong/protocol';
import {
  ToolRegistry,
  type ToolRegistryOptions,
  type TurnRequest,
  type TurnTools,
} from './registry';

/** A pet for tool tests: nothing a tool reads from it but its id and name. */
export const FAKE_TURN_PET: Pet = {
  id: 'scout',
  name: 'Scout',
  notes: 'You are Scout.',
  avatar: 'fox',
  color: '#3b82f6',
  providerId: 'fake',
  model: 'fake-model',
  roleId: 'companion',
  toolGrants: {},
  replyStyle: 'text',
};

/**
 * A turn for testing tools without a runner: a stub pet, a live signal, tool support on.
 * `vision` is left absent unless given, which a tool reads as "cannot see".
 */
export function fakeTurn(overrides: Partial<TurnRequest> = {}): TurnRequest {
  return {
    pet: FAKE_TURN_PET,
    turnId: 'turn-1',
    signal: new AbortController().signal,
    toolSupport: true,
    ...overrides,
  };
}

/**
 * The tools one fake turn gets from a registry wired with `options`, ready to `run`. Every
 * wired tool, unless `options` names a filter: a tool's test is not about the role library.
 */
export function fakeTurnTools(
  options: ToolRegistryOptions,
  overrides: Partial<TurnRequest> = {},
): TurnTools {
  return new ToolRegistry({ toolsFor: (_pet, tools) => tools, ...options }).forTurn(
    fakeTurn(overrides),
  );
}
