/**
 * Type-level companion to methods.test.ts. This file is never executed; it is checked by
 * `pnpm typecheck`, which is what makes "unknown method names fail typecheck" a real gate.
 */
import { paramsSchemaFor, resultSchemaFor } from './methods';
import type { ParamsOf, ResultOf } from './methods';

// Known methods resolve to their own param and result types.
const helloParams: ParamsOf<'hello'> = {
  host: 'desktop',
  version: '0.0.0',
  capabilities: ['selection'],
  token: 't',
};
const askResult: ResultOf<'ask'> = { turnId: '11111111-2222-4333-8444-555555555555' };
void helloParams;
void askResult;
void paramsSchemaFor('settings.get');
void resultSchemaFor('pets.upsert');

// @ts-expect-error 'telepathy' is not in the method catalog.
void paramsSchemaFor('telepathy');

// @ts-expect-error 'turn.delta' is a notification, not a host-to-core method.
void resultSchemaFor('turn.delta');

// @ts-expect-error hello params require a pairing token.
const missingToken: ParamsOf<'hello'> = { host: 'desktop', version: '0.0.0', capabilities: [] };
void missingToken;
