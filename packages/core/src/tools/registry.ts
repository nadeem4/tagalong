import type { Pet } from '@tagalong/protocol';
import type { BrainTool } from '../providers';
import type { MemoryStore } from '../memory/memories';
import { roleFor } from '../roles';
import { recallTools, watchForTool, type WatchToolDeps } from './builtin/awareness';
import { connectorTools, type ConnectorToolDeps } from './builtin/connections';
import { askPetTool, rememberTool, type AskPetDeps } from './builtin/crew';
import { enabledExperts, handToExpertTool, type ExpertToolDeps } from './builtin/experts';
import { perceptionTools, type PerceptionToolsOptions } from './builtin/perception';
import type { Tool, ToolContext, ToolOutcome } from './tool';

/**
 * Narrows the tools a pet gets on a turn. The single place that happens: nothing else in
 * the engine decides which tools a pet has.
 */
export type ToolFilter = (pet: Pet, tools: readonly Tool[]) => readonly Tool[];

/**
 * The default filter: exactly the tools the pet's role lists (the generalist's for a role
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
  /** Gives every pet `ask_pet`, when there is another pet to ask. */
  consult?: AskPetDeps | undefined;
  /** Gives a pet whose role lists it `hand_to_expert`, when an expert is switched on. */
  experts?: ExpertToolDeps | undefined;
  /** The tools of the person's connected apps, for a role that lists `connections`. */
  connections?: ConnectorToolDeps | undefined;
  /** Defaults to `toolsFor`: the tools its role lists, minus any its grants switch off. */
  toolsFor?: ToolFilter | undefined;
}

/** What the runner knows about a turn: the tools' context, and two rules about the set. */
export interface TurnRequest extends ToolContext {
  /** False when the provider cannot call tools: such a turn is sent none at all. */
  toolSupport: boolean;
  /** False keeps `ask_pet` off this turn. Roundtable turns already hear from every pet. */
  allowConsult?: boolean | undefined;
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
 * Built per turn rather than once, because two things only a turn knows shape the set:
 * whether its provider can call tools at all, and who the caller is (`ask_pet` lists the
 * other pets in its description).
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
    const { toolSupport: _support, allowConsult: _consult, ...ctx } = turn;
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
    const { perception, memory, watch, consult, experts, connections } = this.#options;
    const tools: Tool[] = [];
    if (perception) tools.push(...perceptionTools(perception), ...recallTools(perception));
    if (memory) tools.push(rememberTool(memory));
    if (watch) tools.push(watchForTool(watch));
    const others = consult?.pets().filter((pet) => pet.id !== turn.pet.id) ?? [];
    if (consult && turn.allowConsult !== false && others.length > 0) {
      tools.push(askPetTool(consult, turn.pet));
    }
    const switchedOn = experts ? enabledExperts(experts) : [];
    if (experts && switchedOn.length > 0) tools.push(handToExpertTool(experts, switchedOn));
    if (connections) tools.push(...connectorTools(connections));
    return tools;
  }
}
