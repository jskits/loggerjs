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

type ErrorWithCause = Error & { cause?: unknown };
type ErrorWithErrors = Error & { errors: unknown[] };

const AggregateErrorCtor = (
  globalThis as unknown as {
    AggregateError: new (errors: unknown[], message?: string) => ErrorWithErrors;
  }
).AggregateError;

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

  it("preserves and redacts native Error cause", () => {
    const nested = Object.assign(new Error("inner"), { password: SECRET });
    const cause = Object.assign(new Error("outer") as ErrorWithCause, { requestId: "r1" });
    Object.defineProperty(cause, "cause", {
      value: nested,
      writable: true,
      enumerable: false,
      configurable: true,
    });
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { cause } }),
      context,
    ) as LogEvent;
    const redacted = (out.data as { cause: ErrorWithCause }).cause;
    expect(redacted).toBeInstanceOf(Error);
    expect(redacted.cause).toBeInstanceOf(Error);
    expect((redacted.cause as Error & { password: string }).password).toBe("[REDACTED]");
    expect(nested.password).toBe(SECRET);
  });

  it("preserves and redacts AggregateError errors", () => {
    const nested = Object.assign(new Error("nested"), { password: SECRET });
    const aggregate = new AggregateErrorCtor([nested], "many");
    const out = redactProcessor({ keys: ["password"] })(
      eventWith({ data: { aggregate } }),
      context,
    ) as LogEvent;
    const redacted = (out.data as { aggregate: ErrorWithErrors }).aggregate;
    expect(redacted).toBeInstanceOf(AggregateErrorCtor);
    expect(redacted.errors).toHaveLength(1);
    expect((redacted.errors[0] as Error & { password: string }).password).toBe("[REDACTED]");
    expect(nested.password).toBe(SECRET);
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

  it("redacts symbol-keyed Error properties by description and exact symbol matcher", () => {
    const token = Symbol("token");
    const exactSecret = Symbol("exact-secret");
    const cause = new Error("boom") as Error & Record<PropertyKey, unknown>;
    cause[token] = SECRET;
    cause[exactSecret] = SECRET;
    cause.keep = "ok";

    const out = redactProcessor({ keys: ["token", exactSecret] })(
      eventWith({ data: { cause } }),
      context,
    ) as LogEvent;

    const redacted = (out.data as { cause: Error & Record<PropertyKey, unknown> }).cause;
    expect(redacted[token]).toBe("[REDACTED]");
    expect(redacted[exactSecret]).toBe("[REDACTED]");
    expect(redacted.keep).toBe("ok");
    expect(cause[token]).toBe(SECRET);
    expect(cause[exactSecret]).toBe(SECRET);
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

  it("redacts symbol-keyed object and Map entries", () => {
    const objectSecret = Symbol("password");
    const exactMapSecret = Symbol("map-secret");
    const data = {
      [objectSecret]: SECRET,
      nested: new Map<unknown, unknown>([
        [exactMapSecret, SECRET],
        ["user", "alice"],
      ]),
    };

    const out = redactProcessor({ keys: ["password", exactMapSecret] })(
      eventWith({ data }),
      context,
    ) as LogEvent;

    const redacted = out.data as typeof data;
    expect(redacted[objectSecret]).toBe("[REDACTED]");
    expect(redacted.nested.get(exactMapSecret)).toBe("[REDACTED]");
    expect(redacted.nested.get("user")).toBe("alice");
    expect(data[objectSecret]).toBe(SECRET);
    expect(data.nested.get(exactMapSecret)).toBe(SECRET);
  });
});
