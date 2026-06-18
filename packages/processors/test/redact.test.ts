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

  it("covers every default deny-key alias", () => {
    const output = redactProcessor()(
      event({
        password: "p",
        passwd: "pw",
        secret: "s",
        token: "t",
        authorization: "a",
        cookie: "c",
        "set-cookie": "sc",
        apiKey: "ak",
        api_key: "snake",
      }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({
      password: "[REDACTED]",
      passwd: "[REDACTED]",
      secret: "[REDACTED]",
      token: "[REDACTED]",
      authorization: "[REDACTED]",
      cookie: "[REDACTED]",
      "set-cookie": "[REDACTED]",
      apiKey: "[REDACTED]",
      api_key: "[REDACTED]",
    });
  });

  it("supports censor as a replacement alias", () => {
    const output = redactProcessor({ keys: ["token"], censor: "[hidden]" })(
      event({ token: "abc" }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({ token: "[hidden]" });
  });

  it("matches exact paths relative to the event field root", () => {
    const output = redactProcessor({ keys: [], paths: ["user.credentials.password"] })(
      event({ user: { name: "alice", credentials: { password: "secret" } } }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({
      user: { name: "alice", credentials: { password: "[REDACTED]" } },
    });
  });

  it("matches regex keys against the full path", () => {
    const output = redactProcessor({ keys: [/profile\.credentials$/] })(
      event({ profile: { credentials: "secret" }, credentials: "public" }),
      context,
    ) as LogEvent;

    expect(output.data).toEqual({
      profile: { credentials: "[REDACTED]" },
      credentials: "public",
    });
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

  it("preserves nullish values, Date instances, and object cycles", () => {
    const date = new Date("2026-06-19T00:00:00.000Z");
    const input: {
      nothing: null;
      missing?: undefined;
      at: Date;
      self?: unknown;
    } = {
      nothing: null,
      missing: undefined,
      at: date,
    };
    input.self = input;

    const output = redactProcessor({ keys: ["password"] })(event(input), context) as LogEvent;
    const data = output.data as typeof input;

    expect(data.nothing).toBeNull();
    expect(data.missing).toBeUndefined();
    expect(data.at).toBe(date);
    expect(data.self).toBe(data);
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
