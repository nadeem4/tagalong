import type { Pet } from '@tagalong/protocol';
import type { BrainTool } from '../providers';
import type { MemoryStore } from '../memory/memories';
import { roleFor } from '../roles';
import { recallTools, watchForTool, type WatchToolDeps } from './builtin/awareness';
import { connectorTools, type ConnectorToolDeps } from './builtin/connections';
import { recallDayTool, type DayToolDeps } from './builtin/day';
import { searchHistoryTool, type HistoryToolDeps } from './builtin/history';
import { rememberTool } from './builtin/memory';
import { enabledExperts, handToExpertTool, type ExpertToolDeps } from './builtin/experts';
import { perceptionTools, type PerceptionToolsOptions } from './builtin/perception';
import { pointAtTool } from './builtin/pointing';
import { changeRoutineTool, createRoutineTool, type RoutineToolDeps } from './builtin/routines';
import type { Tool, ToolContext, ToolOutcome } from './tool';

/**
 * Narrows the tools a pet gets on a turn. The single place that happens: nothing else in
 * the engine decides which tools a pet has.
 */
export type ToolFilter = (pet: Pet, tools: readonly Tool[]) => readonly Tool[];

/**
 * The default filter: exactly the tools the pet's role lists (the companion's for a role
 * the library does not have), minus any the pet's grants turn off. A grant cannot add a
 * tool the role does not list. A role may list a group (`connections`) for all its tools,
 * and a grant can switch the group off. Registry order is kept.
 */
export const toolsFor: ToolFilter = (pet, tools) => {
  const listed = roleFor(pet.roleId).tools;
  return tools.filter((tool) => {
    if (tool.group !== undefined && listed.includes(tool.group)) {
      return pet.toolGrants[tool.group] !== 'off' && pet.toolGrants[tool.id] !== 'off';
    }
    return listed.includes(tool.id) && pet.toolGrants[tool.id] !== 'off';
  });
};

export interface ToolRegistryOptions {
  /** Hosts, exclusions and budgets for the perception and recall tools. Absent: neither. */
  perception?: PerceptionToolsOptions | undefined;
  /** Gives every pet `remember`. */
  memory?: MemoryStore | undefined;
  /** Gives every pet `watch_for`. */
  watch?: WatchToolDeps | undefined;
  /** Gives a pet whose role lists it `hand_to_expert`, when an expert is switched on. */
  experts?: ExpertToolDeps | undefined;
  /** The tools of the person's connected apps, for a role that lists `connections`. */
  connections?: ConnectorToolDeps | undefined;
  /** Gives a pet whose role lists them `create_routine` and `change_routine`. */
  routines?: RoutineToolDeps | undefined;
  /** Gives a pet whose role lists it `recall_day`, the daily briefing. */
  day?: DayToolDeps | undefined;
  /** Gives a pet whose role lists it `search_history`, the searchable work memory. */
  history?: HistoryToolDeps | undefined;
  /** Defaults to `toolsFor`: the tools its role lists, minus any its grants switch off. */
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
    const { perception, memory, watch, experts, connections, routines, day, history } =
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
    if (day) tools.push(recallDayTool(day));
    if (history) tools.push(searchHistoryTool(history));
    return tools;
  }
}
