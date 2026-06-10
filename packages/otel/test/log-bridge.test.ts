import { describe, expect, it, vi } from "vitest";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import {
  openTelemetryLogBridgeTransport,
  toOpenTelemetryLogBridgeRecord,
  type OpenTelemetryLoggerLike,
} from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 7,
  level: 50,
  levelName: "error",
  logger: "api",
  message: "failed",
  data: { route: "/users" },
  tags: { tenant: "t1" },
  context: { requestId: "req-1" },
  error: {
    name: "TypeError",
    message: "boom",
    stack: "stacktrace",
    code: "ERR_TEST",
  },
  trace: {
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    traceFlags: "01",
  },
};

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError() {},
};

describe("toOpenTelemetryLogBridgeRecord", () => {
  it("maps loggerjs events to OpenTelemetry logger emit records", () => {
    const record = toOpenTelemetryLogBridgeRecord(
      event,
      { attributes: { "service.name": "checkout" } },
      2,
    );

    expect(record).toMatchObject({
      timestamp: 1,
      observedTimestamp: 2,
      severityNumber: 17,
      severityText: "ERROR",
      body: "failed",
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
    });
    expect(record.attributes).toMatchObject({
      "exception.code": "ERR_TEST",
      "exception.message": "boom",
      "exception.stacktrace": "stacktrace",
      "exception.type": "TypeError",
      "log.context": { requestId: "req-1" },
      "log.data": { route: "/users" },
      "log.tags": { tenant: "t1" },
      "loggerjs.event_id": "evt-1",
      "service.name": "checkout",
    });
  });
});

describe("openTelemetryLogBridgeTransport", () => {
  it("emits records through an OpenTelemetry logger", () => {
    const logger: OpenTelemetryLoggerLike = {
      emit: vi.fn<OpenTelemetryLoggerLike["emit"]>(),
    };
    const transport = openTelemetryLogBridgeTransport({ logger });

    transport.log?.(event, context);

    expect(logger.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "failed",
        severityText: "ERROR",
      }),
    );
  });

  it("uses loggerProvider and forwards flush and close", async () => {
    const logger: OpenTelemetryLoggerLike = {
      emit: vi.fn<OpenTelemetryLoggerLike["emit"]>(),
    };
    const provider = {
      forceFlush: vi.fn<() => Promise<void>>(async () => {}),
      getLogger: vi.fn<(name: string, version?: string) => OpenTelemetryLoggerLike>(() => logger),
      shutdown: vi.fn<() => Promise<void>>(async () => {}),
    };
    const transport = openTelemetryLogBridgeTransport({
      loggerName: "api",
      loggerProvider: provider,
      loggerVersion: "1.0.0",
    });

    transport.log?.(event, context);
    await transport.flush?.();
    await transport.close?.();

    expect(provider.getLogger).toHaveBeenCalledWith("api", "1.0.0", undefined);
    expect(logger.emit).toHaveBeenCalledTimes(1);
    expect(provider.forceFlush).toHaveBeenCalledTimes(1);
    expect(provider.shutdown).toHaveBeenCalledTimes(1);
  });

  it("throws when no logger is configured", () => {
    const transport = openTelemetryLogBridgeTransport();

    expect(() => transport.log?.(event, context)).toThrow(
      "OpenTelemetry logger or loggerProvider is required.",
    );
  });
});
