import { describe, expect, it } from "vitest";
import { createLogger, testTransport, type LogEvent } from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

describe("testTransport", () => {
  it("captures events, batches, and bounded drop stats", () => {
    const transport = testTransport({ maxEvents: 2 });

    transport.log?.(event, {
      loggerName: "test",
      now: () => 1,
      reportInternalError() {},
    });
    transport.logBatch?.(
      [
        { ...event, id: "evt-2", seq: 2 },
        { ...event, id: "evt-3", seq: 3 },
      ],
      {
        loggerName: "test",
        now: () => 1,
        reportInternalError() {},
      },
    );

    expect(transport.events.map((item) => item.id)).toEqual(["evt-2", "evt-3"]);
    expect(transport.batches.map((batch) => batch.map((item) => item.id))).toEqual([
      ["evt-2", "evt-3"],
    ]);
    expect(transport.stats).toMatchObject({
      droppedEvents: 1,
      logBatchCalls: 1,
      logCalls: 1,
    });

    transport.clear();

    expect(transport.events).toEqual([]);
    expect(transport.batches).toEqual([]);
    expect(transport.stats.logCalls).toBe(1);

    transport.reset();

    expect(transport.stats).toEqual({
      closeCalls: 0,
      droppedEvents: 0,
      flushCalls: 0,
      logBatchCalls: 0,
      logCalls: 0,
    });
  });

  it("waits for matching events emitted later", async () => {
    const transport = testTransport();
    const logger = createLogger({ transports: [transport] });
    const pending = transport.waitFor((item) => item.message === "ready", { timeoutMs: 100 });

    logger.info("ready", { service: "api" });

    await expect(pending).resolves.toMatchObject({
      data: { service: "api" },
      message: "ready",
    });
  });

  it("waits for existing event counts and rejects timed out waits", async () => {
    const transport = testTransport();
    const logger = createLogger({ transports: [transport] });

    logger.info("skip");
    logger.error("fail");

    await expect(
      transport.waitForCount(1, { matcher: (item) => item.levelName === "error" }),
    ).resolves.toMatchObject([{ message: "fail" }]);
    await expect(transport.waitForCount(3, { timeoutMs: 1 })).rejects.toThrow(
      "Timed out after 1ms",
    );
  });

  it("supports aborting pending waits", async () => {
    const transport = testTransport();
    const controller = new AbortController();
    const pending = transport.waitFor((item) => item.message === "never", {
      signal: controller.signal,
      timeoutMs: 0,
    });

    controller.abort(new Error("cancelled"));

    await expect(pending).rejects.toThrow("cancelled");
  });

  it("injects transport failures and tracks lifecycle calls", async () => {
    const errors: unknown[] = [];
    const transport = testTransport();
    const logger = createLogger({
      onInternalError(error) {
        errors.push(error);
      },
      transports: [transport],
    });

    transport.failNext(new Error("boom"));
    logger.info("lost");
    logger.info("kept");
    await logger.flush();
    await logger.close();

    expect(errors).toHaveLength(1);
    expect(transport.events.map((item) => item.message)).toEqual(["kept"]);
    expect(transport.stats).toMatchObject({
      closeCalls: 1,
      flushCalls: 1,
      logCalls: 2,
    });
  });
});
