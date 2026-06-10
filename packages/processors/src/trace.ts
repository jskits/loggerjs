import type { Processor, TraceContext } from "@loggerjs/core";

export type TraceContextProvider = () => TraceContext | undefined;

export function traceContextProcessor(provider: TraceContextProvider): Processor {
  return (event) => {
    const trace = provider();
    if (!trace) return event;
    return {
      ...event,
      trace: {
        ...(event.trace ?? {}),
        ...trace
      }
    };
  };
}
