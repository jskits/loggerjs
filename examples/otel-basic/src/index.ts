import { createLogger, stdoutTransport } from "@loggerjs/node";
import { openTelemetryTraceProcessor, otlpHttpTransport } from "@loggerjs/otel";

const fakeOtelApi = {
  trace: {
    getActiveSpan: () => ({
      spanContext: () => ({
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        spanId: "00f067aa0ba902b7",
        traceFlags: 1,
      }),
    }),
  },
};

const logger = createLogger({
  name: "otel-example",
  processors: [openTelemetryTraceProcessor({ api: fakeOtelApi })],
  transports: [
    stdoutTransport(),
    otlpHttpTransport({
      url: "http://localhost:4318/v1/logs",
      resource: { "service.name": "loggerjs-example" },
      fetchFn: async () => new Response(null, { status: 200 }),
      maxRecords: 10,
    }),
  ],
});

logger.info("otel correlated event", { orderId: "ord_123" });
await logger.flush();
