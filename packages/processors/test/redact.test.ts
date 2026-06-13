import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { redactProcessor } from "../src/redact";

const context: ProcessorContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError() {},
};

function event(data: unknown): LogEvent {
  return {
    id: "evt-1",
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "test",
    message: "created",
    data,
  };
}

describe("redactProcessor", () => {
  it("masks matching keys without mutating the original data", () => {
    const input = { user: "alice", password: "secret" };
    const output = redactProcessor()(event(input), context) as LogEvent;

    expect(output.data).toEqual({ user: "alice", password: "[REDACTED]" });
    expect(input).toEqual({ user: "alice", password: "secret" });
  });

  it("supports censor as a replacement alias", () => {
    const output = redactProcessor({ keys: ["token"], censor: "[hidden]" })(
      event({ token: "abc" }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({ token: "[hidden]" });
  });

  it("matches exact paths relative to the event field root", () => {
    const output = redactProcessor({ paths: ["user.password"] })(
      event({ user: { name: "alice", password: "secret" } }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({ user: { name: "alice", password: "[REDACTED]" } });
  });

  it("keeps replacement precedence over censor", () => {
    const output = redactProcessor({
      keys: ["token"],
      censor: "[hidden]",
      replacement: "[masked]",
    })(event({ token: "abc" }), context) as LogEvent;

    expect(output.data).toEqual({ token: "[masked]" });
  });

  it("can remove matching fields", () => {
    const output = redactProcessor({ keys: ["password"], remove: true })(
      event({ user: "alice", password: "secret" }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({ user: "alice" });
  });

  it("resets global regex matchers between fields", () => {
    const output = redactProcessor({ keys: [/token/g] })(
      event({ first: { token: "a" }, second: { token: "b" } }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({
      first: { token: "[REDACTED]" },
      second: { token: "[REDACTED]" },
    });
  });
});
