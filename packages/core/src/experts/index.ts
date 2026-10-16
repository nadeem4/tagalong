/**
 * Experts: the back-office agents Scout hands work to. Re-exports the connector contract,
 * the Claude Code connector, the fake, HandoffManager, ExpertStore and RouteMemory.
 */
export {
  CANCELLED,
  renderBrief,
  type Brief,
  type CheckResult,
  type Connector,
  type ConnectorResult,
} from './connector';
export {
  ClaudeCodeConnector,
  type ChildRun,
  type ClaudeCodeOptions,
  type SpawnFn,
} from './claude-code';
export { FakeConnector, type FakeConnectorScript } from './fake';
export { HandoffManager, type HandoffEvent, type HandoffManagerOptions } from './handoffs';
export { ExpertStore } from './store';
export { RouteMemory, type Route, type RoutedBy } from './routes';
