/**
 * How a brain reads in Home and Settings: "Your Claude sign-in · Haiku" or
 * "OpenRouter · anthropic/claude-haiku-4.5". The Claude sign-in names its models by alias,
 * so those are capitalised; a service's model id is shown exactly, since it is what the
 * service calls it.
 */
export function modelLabel(providerId: string, model: string): string {
  if (providerId !== 'claude-code' || model.length === 0) return model;
  return model[0]!.toUpperCase() + model.slice(1);
}

export function brainLabel(providerLabel: string, providerId: string, model: string): string {
  return `${providerLabel} · ${modelLabel(providerId, model)}`;
}
