import { afterEach, describe, expect, it } from "vitest";
import {
  createLogger,
  emitLoggerDiagnostic,
  ndjsonCodec,
  setLoggerDiagnosticSink,
  type LoggerDiagnosticEvent,
  type Transport,
} from "../src";

describe("logger diagnostics", () => {
  const events: LoggerDiagnosticEvent[] = [];

  afterEach(() => {
    setLoggerDiagnosticSink(undefined);
    events.splice(0);
  });

  it("emits dispatch, transport, and flush events when a sink is installed", async () => {
    setLoggerDiagnosticSink((event) => events.push(event));
    const transport: Transport = {
      name: "sink",
      log() {},
      flush() {
        return Promise.resolve();
      },
    };
    const logger = createLogger({ transports: [transport] });

    logger.info("created");
    await logger.flush();

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "dispatch", phase: "start", logger: "app" }),
        expect.objectContaining({ stage: "dispatch", phase: "end", logger: "app" }),
        expect.objectContaining({
          stage: "transport",
          phase: "start",
          logger: "app",
          transport: "sink",
        }),
        expect.objectContaining({
          stage: "transport",
          phase: "end",
          logger: "app",
          transport: "sink",
        }),
        expect.objectContaining({ stage: "flush", phase: "start", logger: "app" }),
        expect.objectContaining({ stage: "flush", phase: "end", logger: "app" }),
      ]),
    );
  });

  it("emits encode events from built-in codecs", () => {
    setLoggerDiagnosticSink((event) => events.push(event));

    ndjsonCodec().encode({
      id: "evt-1",
      time: 1,
      seq: 1,
      level: 30,
      levelName: "info",
      logger: "test",
      message: "created",
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "encode", phase: "start", codec: "ndjson" }),
        expect.objectContaining({ stage: "encode", phase: "end", codec: "ndjson" }),
      ]),
    );
  });

  it("stops emitting after the sink is removed", () => {
    setLoggerDiagnosticSink((event) => events.push(event));
    emitLoggerDiagnostic({ stage: "dispatch", phase: "start" });
    setLoggerDiagnosticSink(undefined);
    emitLoggerDiagnostic({ stage: "dispatch", phase: "end" });

    expect(events).toEqual([{ stage: "dispatch", phase: "start" }]);
  });
});
