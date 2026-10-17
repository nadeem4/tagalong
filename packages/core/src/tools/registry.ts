/**
 * Builds a turn's tools and dispatches them. Contains `ToolRegistry`, `toolsFor` (the
 * role's tools) and the turn types. The runner builds one registry
 * and calls `forTurn` per turn.
 */
import type { Pet } from '@tagalong/protocol';
import type { BrainTool } from '../providers';
import type { MemoryStore } from '../memory/memories';
import { roleFor } from '../roles';
import { recallTools, watchForTool, type WatchToolDeps } from './builtin/awareness';
import { connectorTools, type ConnectorToolDeps } from './builtin/connections';
import { searchHistoryTool, type HistoryToolDeps } from './builtin/history';
import { forgetTool, rememberTool } from './builtin/memory';
import {
  enabledExperts,
  handToExpertTool,
  tellExpertTool,
  type ExpertToolDeps,
} from './builtin/experts';
import { perceptionTools, type PerceptionToolsOptions } from './builtin/perception';
import { pointAtTool } from './builtin/pointing';
import { changeRoutineTool, createRoutineTool, type RoutineToolDeps } from './builtin/routines';
import { changeSettingsTool, type SettingsToolDeps } from './builtin/settings';
import type { Tool, ToolContext, ToolOutcome } from './tool';

/**
 * Narrows the tools a pet gets on a turn. The single place that happens: nothing else in
 * the engine decides which tools a pet has.
 */
export type ToolFilter = (pet: Pet, tools: readonly Tool[]) => readonly Tool[];

/**
 * The default filter: exactly the tools the pet's role lists (the companion's for a role
 * the library does not have). A role may list a group (`connections`) for all its tools.
 * Registry order is kept.
 */
export const toolsFor: ToolFilter = (pet, tools) => {
  const listed = roleFor(pet.roleId).tools;
  return tools.filter((tool) =>
    tool.group !== undefined && listed.includes(tool.group) ? true : listed.includes(tool.id),
  );
};

export interface ToolRegistryOptions {
  /** Hosts, exclusions and budgets for the perception and recall tools. Absent: neither. */
  perception?: PerceptionToolsOptions | undefined;
  /** Gives every pet `remember`, and `forget` outside a routine's own turn. */
  memory?: MemoryStore | undefined;
  /** Gives every pet `watch_for`. */
  watch?: WatchToolDeps | undefined;
  /** Gives a pet whose role lists it `hand_to_expert`, when an expert is switched on. */
  experts?: ExpertToolDeps | undefined;
  /** The tools of the person's connected apps, for a role that lists `connections`. */
  connections?: ConnectorToolDeps | undefined;
  /** Gives a pet whose role lists them `create_routine` and `change_routine`. */
  routines?: RoutineToolDeps | undefined;
  /** Gives a pet whose role lists it `search_history`: searches and day listings. */
  history?: HistoryToolDeps | undefined;
  /**
   * Gives a pet whose role lists it `change_settings`, which shows the settings card. It is
   * offered on a routine's turn too, but refuses there anything that loosens privacy.
   */
  changeSettings?: SettingsToolDeps | undefined;
  /** Defaults to `toolsFor`: the tools its role lists. */
  toolsFor?: ToolFilter | undefined;
}

/** What the runner knows about a turn: the tools' context, and two rules about the set. */
export interface TurnRequest extends ToolContext {
  /** False when the provider cannot call tools: such a turn is sent none at all. */
  toolSupport: boolean;
}

export interface ToolCall {
  name: string;
  input?: unknown;
}

/** One turn's tools, bound to that turn. */
export interface TurnTools {
  readonly tools: readonly Tool[];
  readonly definitions: readonly BrainTool[];
  /** The one dispatch. A name this turn was not given is refused by name, never thrown. */
  run(call: ToolCall): Promise<ToolOutcome>;
}

/**
 * Builds the full set of tools for a turn and dispatches them one way.
 *
 * Built per turn rather than once, because what only a turn knows shapes the set: whether
 * its provider can call tools at all, who the caller is, and whether a routine started it.
 */
export class ToolRegistry {
  readonly #options: ToolRegistryOptions;

  constructor(options: ToolRegistryOptions) {
    this.#options = options;
  }

  forTurn(turn: TurnRequest): TurnTools {
    const tools = turn.toolSupport
      ? (this.#options.toolsFor ?? toolsFor)(turn.pet, this.#all(turn))
      : [];
    const { toolSupport: _support, ...ctx } = turn;
    return {
      tools,
      definitions: tools.map((tool) => tool.definition),
      run(call) {
        const tool = tools.find((candidate) => candidate.id === call.name);
        if (tool === undefined) {
          // Named back so the model can correct itself instead of retrying blindly.
          return Promise.resolve({
            content: `'${call.name}' is not a tool Tagalong provides.`,
            isError: true,
          });
        }
        return tool.run(call.input, ctx);
      },
    };
  }

  /** Every built-in this engine is wired for, in the order the model has always seen. */
  #all(turn: TurnRequest): Tool[] {
    const { perception, memory, watch, experts, connections, routines, history, changeSettings } =
      this.#options;
    const tools: Tool[] = [];
    if (perception) tools.push(...perceptionTools(perception), ...recallTools(perception));
    if (memory) tools.push(rememberTool(memory));
    // A routine's own turn never starts a watch: a watch routine could set off itself.
    if (watch && turn.routine === undefined) tools.push(watchForTool(watch));
    const switchedOn = experts ? enabledExperts(experts) : [];
    if (experts && switchedOn.length > 0) tools.push(handToExpertTool(experts, switchedOn));
    if (connections) tools.push(...connectorTools(connections));
    // A routine's own turn never sets up or changes routines.
    if (routines && turn.routine === undefined) {
      tools.push(createRoutineTool(routines));
      const saved = routines.list();
      if (saved.length > 0) tools.push(changeRoutineTool(routines, saved));
    }
    // Appended last: the order is what the model has always seen.
    if (perception) tools.push(pointAtTool(perception));
    if (history) tools.push(searchHistoryTool(history));
    // Only while an expert works, and never on a routine's own turn: nobody is there to say it.
    const running = experts?.running?.() ?? [];
    if (experts?.steer && running.length > 0 && turn.routine === undefined) {
      tools.push(tellExpertTool(experts, running));
    }
    if (changeSettings) tools.push(changeSettingsTool(changeSettings));
    // Deleting a memory is the person's call: a routine's own turn has nobody to ask it.
    if (memory && turn.routine === undefined) tools.push(forgetTool(memory));
    return tools;
  }
}
