import type { Pet, Role } from '@tagalong/protocol';

/** A slate colour: the base character, recoloured, until the user picks a look. */
const NEW_AGENT_COLOR = '#64748b';

/**
 * A fresh agent for Home's Add agent button: a Generalist at the library's version, on the
 * brain the host picked, named "New agent" (numbered when that is taken) with the base
 * character. Not a hiring flow: the user shapes it in its controls straight after.
 */
export function newAgent(input: {
  pets: readonly Pet[];
  roles: readonly Role[];
  providerId: string;
  model: string;
  visionModel?: string | undefined;
}): Pet {
  const ids = new Set(input.pets.map((pet) => pet.id));
  const names = new Set(input.pets.map((pet) => pet.name));
  const idFor = (n: number) => (n === 1 ? 'new-agent' : `new-agent-${n}`);
  const nameFor = (n: number) => (n === 1 ? 'New agent' : `New agent ${n}`);
  let n = 1;
  while (ids.has(idFor(n)) || names.has(nameFor(n))) n += 1;
  const generalist = input.roles.find((role) => role.id === 'generalist');
  return {
    id: idFor(n),
    name: nameFor(n),
    avatar: '🐾',
    color: NEW_AGENT_COLOR,
    roleId: 'generalist',
    roleVersion: generalist?.version ?? 1,
    providerId: input.providerId,
    model: input.model,
    ...(input.visionModel === undefined ? {} : { visionModel: input.visionModel }),
    toolGrants: {},
    replyStyle: 'text',
  };
}
