import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { normalizeErrorProcessor } from "../src/normalize-error";

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

function event(error?: LogEvent["error"], data?: unknown): LogEvent {
  return {
    id: "evt-1",
    time: 1,
    seq: 1,
    level: 50,
    levelName: "error",
    logger: "app",
    message: "failed",
    error,
    data,
  };
}

describe("normalizeErrorProcessor", () => {
  it("normalizes nested causes, aggregate errors, and stack limits", () => {
    const cause = new Error("database down");
    cause.stack = "Error: database down\n    at db1\n    at db2";

    const aggregate = new Error("request failed") as Error & {
      cause?: unknown;
      code?: string;
      errors?: unknown[];
    };
    aggregate.name = "AggregateError";
    aggregate.code = "E_REQUEST";
    aggregate.cause = cause;
    aggregate.errors = [new TypeError("bad payload"), "plain failure"];
    aggregate.stack = "AggregateError: request failed\n    at first\n    at second";

    const processor = normalizeErrorProcessor({ maxStackLines: 2 });
    const processed = processor(event(aggregate as unknown as LogEvent["error"]), context);

    expect(processed).toMatchObject({
      error: {
        name: "AggregateError",
        message: "request failed",
        code: "E_REQUEST",
        stack: "AggregateError: request failed\n    at first",
        cause: {
          name: "Error",
          message: "database down",
          stack: "Error: database down\n    at db1",
        },
        errors: [{ name: "TypeError", message: "bad payload" }, { message: "plain failure" }],
      },
    });
  });

  it("limits cause depth and handles cycles", () => {
    const first = { name: "First", message: "one", cause: undefined as unknown };
    const second = { name: "Second", message: "two", cause: first };
    first.cause = second;

    const processor = normalizeErrorProcessor({ maxDepth: 1 });
    const processed = processor(event(first as LogEvent["error"]), context) as LogEvent;

    expect(processed.error?.cause).toMatchObject({
      name: "Second",
      cause: { message: "[Max error depth]" },
    });
  });

  it("normalizes configured data error keys", () => {
    const dataError = new RangeError("bad range");
    const processor = normalizeErrorProcessor({ dataErrorKeys: ["failure"] });
    const processed = processor(event(undefined, { failure: dataError, untouched: true }), context);

    expect(processed).toMatchObject({
      data: {
        failure: { name: "RangeError", message: "bad range" },
        untouched: true,
      },
    });
  });
});
