import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { redactProcessor } from "../src/redact";

const context: ProcessorContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError() {},
};

function eventWith(fields: Partial<LogEvent>): LogEvent {
  return {
    id: "evt-1",
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "test",
    message: "created",
    ...fields,
  };
}

const SECRET = "TOP-SECRET-VALUE";

describe("redactProcessor — Error own-property leak (fail closed)", () => {
  it("redacts a configured key carried as an own property on a nested Error", () => {
    const cause = Object.assign(new Error("boom"), { password: SECRET, requestId: "r1" });
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { cause } }),
      context,
    ) as LogEvent;
    const redacted = (out.data as { cause: Error & { password: string; requestId: string } }).cause;
    expect(redacted.password).toBe("[REDACTED]");
    expect(redacted.requestId).toBe("r1");
    expect(JSON.stringify(out.data)).not.toContain(SECRET);
  });

  it("preserves the Error subclass, name, message and original stack", () => {
    const cause = Object.assign(new TypeError("bad type"), { password: SECRET });
    const originalStack = cause.stack;
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { cause } }),
      context,
    ) as LogEvent;
    const redacted = (out.data as { cause: TypeError }).cause;
    expect(redacted).toBeInstanceOf(TypeError);
    expect(redacted).toBeInstanceOf(Error);
    expect(redacted.name).toBe("TypeError");
    expect(redacted.message).toBe("bad type");
    expect(redacted.stack).toBe(originalStack);
  });

  it("keeps message/stack non-enumerable so default JSON output is only redacted", () => {
    const cause = Object.assign(new Error("boom"), { password: SECRET });
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { cause } }),
      context,
    ) as LogEvent;
    // JSON.stringify emits only enumerable own props -> the secret prop, now masked.
    expect(JSON.stringify((out.data as { cause: Error }).cause)).toBe('{"password":"[REDACTED]"}');
  });

  it("does not mutate the input Error", () => {
    const cause = Object.assign(new Error("boom"), { password: SECRET });
    redactProcessor({ keys: ["password"] })(eventWith({ data: { cause } }), context) as LogEvent;
    expect(cause.password).toBe(SECRET);
  });

  it("returns a plain Error (no own enumerable props) unchanged by identity", () => {
    const cause = new Error("plain");
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { cause } }),
      context,
    ) as LogEvent;
    expect((out.data as { cause: Error }).cause).toBe(cause);
  });

  it("removes the matched key on an Error when remove:true", () => {
    const cause = Object.assign(new Error("boom"), { password: SECRET, keep: 1 });
    const out = redactProcessor({ keys: ["password"], remove: true })(
      eventWith({ data: { cause } }),
      context,
    ) as LogEvent;
    const redacted = (out.data as { cause: Error & { keep: number } }).cause;
    expect("password" in redacted).toBe(false);
    expect(redacted.keep).toBe(1);
  });
});

describe("redactProcessor — Map / Set (preserve + redact, not drop)", () => {
  it("redacts string-keyed Map entries and preserves the Map and non-secret entries", () => {
    const creds = new Map<string, unknown>([
      ["password", SECRET],
      ["user", "alice"],
    ]);
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { creds } }),
      context,
    ) as LogEvent;
    const map = (out.data as { creds: Map<string, unknown> }).creds;
    expect(map).toBeInstanceOf(Map);
    expect(map.get("password")).toBe("[REDACTED]");
    expect(map.get("user")).toBe("alice");
  });

  it("recurses into Set members (preserves the Set, redacts nested object keys)", () => {
    const tags = new Set<unknown>([{ password: SECRET }, "plain"]);
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { tags } }),
      context,
    ) as LogEvent;
    const set = (out.data as { tags: Set<unknown> }).tags;
    expect(set).toBeInstanceOf(Set);
    const members = [...set];
    expect(members).toContainEqual({ password: "[REDACTED]" });
    expect(members).toContain("plain");
  });

  it("does not mutate the input Map", () => {
    const creds = new Map([["password", SECRET]]);
    redactProcessor({ keys: ["password"] })(eventWith({ data: { creds } }), context) as LogEvent;
    expect(creds.get("password")).toBe(SECRET);
  });
});
