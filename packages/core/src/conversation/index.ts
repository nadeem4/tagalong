/**
 * Turn assembly and execution. The engine imports from here so it never has to know
 * whether a change landed in the assembler or the runner.
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
