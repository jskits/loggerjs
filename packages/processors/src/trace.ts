import {
  createMiddleware,
  type Middleware,
  type Processor,
  type TraceContext,
} from "@loggerjs/core";

export type TraceContextProvider = () => TraceContext | undefined;

export function traceContextMiddleware(provider: TraceContextProvider): Middleware {
  return createMiddleware("traceContext", (record) => {
    const trace = provider();
    if (!trace) return record;
    record.trace = {
      ...record.trace,
      ...trace,
    };
    return record;
  });
}

export function traceContextProcessor(provider: TraceContextProvider): Processor {
  return (event) => {
    const trace = provider();
    if (!trace) return event;
    return {
      ...event,
      trace: {
        ...event.trace,
        ...trace,
      },
    };
  };
}
