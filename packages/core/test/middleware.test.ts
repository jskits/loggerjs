import { describe, expect, it } from "vitest";
import {
  createMiddleware,
  createRecord,
  getLoggerMetaStats,
  resetLoggerMetaStats,
  runMiddleware,
  type MiddlewareContext,
} from "../src";

const context: MiddlewareContext = {
  now: () => 1,
  reportInternalError() {},
};

describe("middleware runner", () => {
  it("runs synchronous middleware in order", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      msg: "created",
      seq: 1,
    });

    const result = runMiddleware(
      record,
      [
        createMiddleware("first", (current) => {
          current.props = { first: true };
          return current;
        }),
        createMiddleware("second", (current) => {
          current.source = "middleware:test";
          return current;
        }),
      ],
      context,
    );

    expect(result).toMatchObject({
      props: { first: true },
      source: "middleware:test",
    });
  });

  it("returns null when middleware drops a record", () => {
    const record = createRecord({
      time: 1,
      level: 30,
      msg: "created",
      seq: 1,
    });

    const result = runMiddleware(
      record,
      [
        createMiddleware("drop", () => null),
        createMiddleware("never", (current) => {
          current.source = "should-not-run";
          return current;
        }),
      ],
      context,
    );

    expect(result).toBeNull();
    expect(record.source).toBe("app");
  });

  it("reports thrown middleware errors and continues with the current record", () => {
    resetLoggerMetaStats();
    const record = createRecord({
      time: 1,
      level: 30,
      msg: "created",
      seq: 1,
    });

    const result = runMiddleware(
      record,
      [
        createMiddleware("fail", () => {
          throw new Error("middleware failed");
        }),
        createMiddleware("after", (current) => {
          current.source = "middleware:after";
          return current;
        }),
      ],
      context,
    );

    expect(result?.source).toBe("middleware:after");
    expect(getLoggerMetaStats()).toMatchObject({
      "middleware.errors": 1,
    });
  });
});
