/**
 * Turn assembly and execution: assemblePrompt builds one turn's request and
 * ConversationRunner runs it. The engine imports from here.
 */
export {
  CONTEXT_LABELS,
  MAX_OUTPUT_TOKENS,
  MAX_SELECTION_CHARS,
  TRUNCATION_MARKER,
  assemblePrompt,
  type AssembleInput,
} from './prompt-assembler';
export {
  ConversationRunner,
  type ConversationRunnerOptions,
  type RunAsk,
  type TurnEvent,
  type TurnEventSink,
  type TurnHandle,
  type TurnOutcome,
} from './runner';
