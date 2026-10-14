/**
 * The tools module: one `Tool` shape, a registry that builds a turn's tools, and the
 * built-ins. Code outside this folder imports from here or from `./registry`, never from
 * `./builtin/*` (an ESLint rule holds the runner and engine to it).
 */
export {
  ToolRegistry,
  toolsFor,
  type ToolCall,
  type ToolFilter,
  type ToolRegistryOptions,
  type TurnRequest,
  type TurnTools,
} from './registry';
export {
  defineTool,
  type RoutineTurnContext,
  type Tool,
  type ToolContext,
  type ToolKind,
  type ToolOutcome,
} from './tool';
export {
  GET_SELECTION,
  LIST_DISPLAYS,
  LIST_WINDOWS,
  LOOK_AT_DISPLAY,
  LOOK_AT_SCREEN,
  LOOK_CLOSER,
  READ_WINDOW_TEXT,
  type PerceptionToolsOptions,
} from './builtin/perception';
export { RECALL_SCREEN, WATCH_FOR, WHAT_CHANGED, type WatchToolDeps } from './builtin/awareness';
export { REMEMBER } from './builtin/memory';
export { HAND_TO_EXPERT, type ExpertToolDeps } from './builtin/experts';
export { CHANGE_ROUTINE, CREATE_ROUTINE, type RoutineToolDeps } from './builtin/routines';
export {
  CONNECTIONS_GROUP,
  CONNECTOR_SEPARATOR,
  type ConnectorToolDeps,
} from './builtin/connections';
