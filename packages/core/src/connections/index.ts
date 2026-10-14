/**
 * Connections: the person's apps over MCP. The manager keeps one client per switched-on
 * connection, the approvals hold writes until the person allows them, and the catalog
 * and the Claude Code reader fill Home's Popular and Found on this PC lists.
 */
export { accessOf } from './access';
export { APPROVAL_TIMEOUT_MS, Approvals, type ApprovalAnswer } from './approvals';
export { POPULAR_CONNECTORS } from './catalog';
export {
  claudeCodeConfigPath,
  foundInClaudeCode,
  readClaudeCodeConnectors,
} from './claude-code-config';
export {
  ConnectionManager,
  MAX_RESULT_CHARS,
  type AppTool,
  type CallResult,
  type ConnectionManagerOptions,
  type TransportContext,
  type TransportFor,
} from './manager';
export { oauthSecretKey } from './oauth';
export { ConnectionStore } from './store';
