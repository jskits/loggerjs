import {
  createBoundContext,
  createMiddleware,
  type Middleware,
  type Processor,
  type Tags,
} from "@loggerjs/core";

export function tagsMiddleware(tags: Tags): Middleware {
  return createMiddleware("tags", (record) => {
    record.tags = {
      ...record.tags,
      ...tags,
    };
    return record;
  });
}

export function typeMiddleware(type: string): Middleware {
  return createMiddleware("type", (record) => {
    record.type = type;
    return record;
  });
}

export function contextMiddleware(context: Record<string, unknown>): Middleware {
  return createMiddleware("context", (record) => {
    record.ctx = createBoundContext({
      ...record.ctx,
      ...context,
    });
    return record;
  });
}

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
