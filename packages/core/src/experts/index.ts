/**
 * Experts: the back-office agents Scout hands work to. Re-exports the connector contract,
 * the Claude Code connector, the fake, HandoffManager and ExpertStore.
 */
export { renderBrief, type Brief, type Connector, type ConnectorResult } from './connector';
export { ClaudeCodeConnector } from './claude-code';
export { FakeConnector } from './fake';
export { HandoffManager } from './handoffs';
export { ExpertStore } from './store';
