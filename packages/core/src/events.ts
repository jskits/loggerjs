import type { EventDefinition } from "./types";

export function defineEvent<TPayload extends Record<string, unknown>>(
  definition: EventDefinition<TPayload>,
): EventDefinition<TPayload> {
  return Object.freeze({ ...definition });
}
