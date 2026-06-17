import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { privacyGuardProcessor } from "../src/privacy-guard";

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

function eventWith(data: unknown): LogEvent {
  return {
    id: "evt-1",
    time: 1,
    seq: 1,
    level: 30,
    levelName: "info",
    logger: "app",
    message: "created",
    data,
  };
}

const SECRET = "TOP-SECRET-VALUE";

describe("privacyGuardProcessor — Error / Map / Set", () => {
  it("guards a deny-key carried on a nested Error, preserving the Error and message", () => {
    const cause = Object.assign(new Error("boom"), { password: SECRET, ok: "v" });
    const out = privacyGuardProcessor({ denyKeys: ["password"] })(
      eventWith({ cause }),
      context,
    ) as LogEvent;
    const guarded = (out.data as { cause: Error & { password: string; ok: string } }).cause;
    expect(guarded).toBeInstanceOf(Error);
    expect(guarded.message).toBe("boom");
    expect(guarded.password).toBe("[REDACTED]");
    expect(guarded.ok).toBe("v");
    expect(JSON.stringify(out.data)).not.toContain(SECRET);
  });

  it("guards deny-keys and scans PII inside Map entries (preserving the Map)", () => {
    const creds = new Map<string, unknown>([
      ["password", SECRET],
      ["note", "ping buyer@example.com"],
    ]);
    const out = privacyGuardProcessor({ denyKeys: ["password"] })(
      eventWith({ creds }),
      context,
    ) as LogEvent;
    const map = (out.data as { creds: Map<string, unknown> }).creds;
    expect(map).toBeInstanceOf(Map);
    expect(map.get("password")).toBe("[REDACTED]");
    expect(map.get("note")).not.toContain("buyer@example.com");
  });

  it("scans PII inside Set members (preserving the Set)", () => {
    const tags = new Set<unknown>(["contact buyer@example.com"]);
    const out = privacyGuardProcessor()(eventWith({ tags }), context) as LogEvent;
    const set = (out.data as { tags: Set<unknown> }).tags;
    expect(set).toBeInstanceOf(Set);
    expect(String([...set][0])).not.toContain("buyer@example.com");
  });

  it("leaves a plain Error unchanged by identity", () => {
    const cause = new Error("plain");
    const out = privacyGuardProcessor({ denyKeys: ["password"] })(
      eventWith({ cause }),
      context,
    ) as LogEvent;
    expect((out.data as { cause: Error }).cause).toBe(cause);
  });

  it("does not mutate the input Error", () => {
    const cause = Object.assign(new Error("boom"), { password: SECRET });
    privacyGuardProcessor({ denyKeys: ["password"] })(eventWith({ cause }), context) as LogEvent;
    expect(cause.password).toBe(SECRET);
  });
});
