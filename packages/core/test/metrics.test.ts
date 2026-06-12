import { describe, expect, it } from "vitest";
import {
  batchTransport,
  getLoggerMetaGauges,
  getLoggerMetaStats,
  getLoggerSelfMetrics,
  metricsCodec,
  ndjsonCodec,
  resetLoggerMetaStats,
  type LogEvent,
  type TransportContext,
} from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  toEvent: () => event,
  reportInternalError() {},
};

describe("logger self metrics", () => {
  it("exposes counters and gauges in one snapshot", async () => {
    resetLoggerMetaStats();
    const transport = batchTransport(
      {
        name: "inner",
        logBatch() {},
      },
      { name: "metrics-batch", flushIntervalMs: 0 },
    );

    transport.log?.(event, context);
    expect(transport.stats()).toMatchObject({
      maxQueueDepth: 1,
      queueDepth: 1,
    });
    expect(getLoggerMetaGauges()).toMatchObject({
      "transport.queue.depth.metrics-batch": 1,
    });

    await transport.flush?.();

    expect(transport.stats()).toMatchObject({
      flushes: 1,
      queueDepth: 0,
    });
    expect(getLoggerSelfMetrics().gauges).toMatchObject({
      "transport.queue.depth.metrics-batch": 0,
    });
  });

  it("counts codec calls and serialized bytes through metricsCodec", () => {
    resetLoggerMetaStats();
    const codec = metricsCodec(ndjsonCodec(), { name: "wire" });
    const payload = codec.encode(event);

    expect(payload).toContain("created");
    expect(getLoggerMetaStats()).toMatchObject({
      "codec.encode": 1,
      "codec.encode.wire": 1,
      "codec.encoded.bytes": payload.length,
      "codec.encoded.bytes.wire": payload.length,
    });
  });
});
