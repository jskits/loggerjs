import type { Processor, Tags } from "@loggerjs/core";

export function tagsProcessor(tags: Tags): Processor {
  return (event) => ({
    ...event,
    tags: {
      ...event.tags,
      ...tags,
    },
  });
}

export function typeProcessor(type: string): Processor {
  return (event) => ({
    ...event,
    type,
  });
}

export function contextProcessor(context: Record<string, unknown>): Processor {
  return (event) => ({
    ...event,
    context: {
      ...event.context,
      ...context,
    },
  });
}
