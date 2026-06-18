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
  it("normalizes primitive and nullish thrown values", () => {
    const processor = normalizeErrorProcessor();

    expect(
      processor(event("plain failure" as unknown as LogEvent["error"]), context),
    ).toMatchObject({
      error: { message: "plain failure" },
    });
    expect(processor(event(42 as unknown as LogEvent["error"]), context)).toMatchObject({
      error: { message: "42" },
    });
    expect(processor(event(null as unknown as LogEvent["error"]), context)).toMatchObject({
      error: { message: "null" },
    });
  });

  it("falls back when error name and message properties are not strings", () => {
    const processed = normalizeErrorProcessor()(
      event({ name: 123, message: 456 } as unknown as LogEvent["error"]),
      context,
    ) as LogEvent;

    expect(processed.error).toMatchObject({
      message: "[object Object]",
    });
    expect(processed.error).toHaveProperty("name", undefined);
  });

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

  it("detects circular error causes before recursing forever", () => {
    const circular = {
      name: "CircularError",
      message: "loop",
      cause: undefined as unknown,
    };
    circular.cause = circular;

    const processed = normalizeErrorProcessor()(event(circular as LogEvent["error"]), context);

    expect(processed).toMatchObject({
      error: {
        name: "CircularError",
        message: "loop",
        cause: { message: "[Circular error]" },
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

  it("can omit stacks, aggregate errors, and enumerable extras", () => {
    const errorWithExtras = Object.assign(new Error("failed"), {
      code: 503,
      retryable: true,
      errors: [new Error("nested")],
    });
    errorWithExtras.stack = "Error: failed\n    at first";

    const processed = normalizeErrorProcessor({
      maxStackLines: 0,
      includeAggregateErrors: false,
      includeEnumerableProperties: false,
    })(event(errorWithExtras as unknown as LogEvent["error"]), context);

    expect(processed).toMatchObject({
      error: {
        name: "Error",
        message: "failed",
        code: 503,
      },
    });
    expect((processed as LogEvent).error?.stack).toBeUndefined();
    expect((processed as LogEvent).error).not.toHaveProperty("errors");
    expect((processed as LogEvent).error).not.toHaveProperty("retryable");
  });

  it("keeps enumerable extras by default", () => {
    const errorWithExtras = Object.assign(new Error("failed"), {
      code: { nested: true },
      retryable: true,
    });

    const processed = normalizeErrorProcessor()(
      event(errorWithExtras as unknown as LogEvent["error"]),
      context,
    ) as LogEvent;

    expect(processed.error).toMatchObject({
      name: "Error",
      message: "failed",
      code: { nested: true },
      retryable: true,
    });
  });

  it("omits non-string and non-number codes when enumerable extras are disabled", () => {
    const errorWithObjectCode = Object.assign(new Error("failed"), {
      code: { nested: true },
    });

    const processed = normalizeErrorProcessor({ includeEnumerableProperties: false })(
      event(errorWithObjectCode as unknown as LogEvent["error"]),
      context,
    ) as LogEvent;

    expect(processed.error).toMatchObject({
      name: "Error",
      message: "failed",
    });
    expect(processed.error).not.toHaveProperty("code");
  });

  it("keeps string codes even when enumerable extras are disabled", () => {
    const errorWithStringCode = Object.assign(new Error("failed"), {
      code: "E_TEST",
      retryable: true,
    });

    const processed = normalizeErrorProcessor({ includeEnumerableProperties: false })(
      event(errorWithStringCode as unknown as LogEvent["error"]),
      context,
    ) as LogEvent;

    expect(processed.error).toMatchObject({
      name: "Error",
      message: "failed",
      code: "E_TEST",
    });
    expect(processed.error).not.toHaveProperty("retryable");
  });

  it("does not copy raw aggregate errors when aggregate expansion is disabled", () => {
    const aggregate = Object.assign(new Error("failed"), {
      errors: [new Error("nested")],
      retryable: true,
    });

    const processed = normalizeErrorProcessor({ includeAggregateErrors: false })(
      event(aggregate as unknown as LogEvent["error"]),
      context,
    ) as LogEvent;

    expect(processed.error).toMatchObject({
      name: "Error",
      message: "failed",
      retryable: true,
    });
    expect(processed.error).not.toHaveProperty("errors");
  });

  it("does not copy undefined enumerable causes into normalized output", () => {
    const errorWithUndefinedCause = Object.assign(new Error("failed"), {
      cause: undefined,
      retryable: true,
    });

    const processed = normalizeErrorProcessor()(
      event(errorWithUndefinedCause as unknown as LogEvent["error"]),
      context,
    ) as LogEvent;

    expect(processed.error).toMatchObject({
      name: "Error",
      message: "failed",
      retryable: true,
    });
    expect(processed.error).not.toHaveProperty("cause");
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

  it("leaves data unchanged when configured error keys are absent or nullish", () => {
    const data = { failure: null, untouched: true };
    const processor = normalizeErrorProcessor({ dataErrorKeys: ["failure", "missing"] });

    expect((processor(event(undefined, data), context) as LogEvent).data).toBe(data);
    expect((processor(event(undefined, null), context) as LogEvent).data).toBeNull();
    const arrayData = [new Error("array error")];
    expect((processor(event(undefined, arrayData), context) as LogEvent).data).toBe(arrayData);
    expect((processor(event(undefined, "not-record"), context) as LogEvent).data).toBe(
      "not-record",
    );
  });
});
