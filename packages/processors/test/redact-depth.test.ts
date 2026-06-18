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

const SECRET = "TOP-SECRET-VALUE";

/** Wrap `leaf` in `depth` levels of plain-object nesting. */
function nestObject(depth: number, leaf: unknown): unknown {
  let node = leaf;
  for (let i = 0; i < depth; i += 1) node = { level: node };
  return node;
}

/** Wrap `leaf` in `depth` levels of single-element array nesting. */
function nestArray(depth: number, leaf: unknown): unknown {
  let node = leaf;
  for (let i = 0; i < depth; i += 1) node = [node];
  return node;
}

describe("redactProcessor depth handling (fail closed)", () => {
  it("regression: a secret nested past the default maxDepth=8 must not leak", () => {
    // This is the exact shape that previously returned the raw subtree verbatim.
    const data = nestObject(9, { password: SECRET });
    const out = redactProcessor()(event(data), context) as LogEvent;
    expect(JSON.stringify(out.data)).not.toContain(SECRET);
  });

  it("never emits a configured key in plaintext at any object depth (0..20)", () => {
    for (let depth = 0; depth <= 20; depth += 1) {
      const data = nestObject(depth, { password: SECRET, token: SECRET, apiKey: SECRET });
      const out = redactProcessor()(event(data), context) as LogEvent;
      expect(JSON.stringify(out.data), `leaked at object depth ${depth}`).not.toContain(SECRET);
    }
  });

  it("never emits a configured key in plaintext at any array depth (0..20)", () => {
    for (let depth = 0; depth <= 20; depth += 1) {
      const data = nestArray(depth, { authorization: SECRET });
      const out = redactProcessor()(event(data), context) as LogEvent;
      expect(JSON.stringify(out.data), `leaked at array depth ${depth}`).not.toContain(SECRET);
    }
  });

  it("honors custom maxDepth without leaking past the boundary", () => {
    for (const maxDepth of [0, 1, 2, 4]) {
      for (let depth = 0; depth <= maxDepth + 3; depth += 1) {
        const data = nestObject(depth, { secret: SECRET });
        const out = redactProcessor({ maxDepth })(event(data), context) as LogEvent;
        expect(
          JSON.stringify(out.data),
          `leaked at depth ${depth} with maxDepth ${maxDepth}`,
        ).not.toContain(SECRET);
      }
    }
  });

  it("replaces the truncated subtree with the configured replacement", () => {
    const out = redactProcessor({ replacement: "[CUT]" })(
      event(nestObject(12, { note: "deep-but-not-a-secret" })),
      context,
    ) as LogEvent;
    const serialized = JSON.stringify(out.data);
    // The too-deep subtree is collapsed to the replacement token, not emitted raw.
    expect(serialized).toContain("[CUT]");
    expect(serialized).not.toContain("deep-but-not-a-secret");
  });

  it("uses replacement for maxDepth truncation even when remove=true", () => {
    const out = redactProcessor({ maxDepth: 2, remove: true, replacement: "[CUT]" })(
      event(nestObject(4, { secret: SECRET })),
      context,
    ) as LogEvent;
    expect(out.data).toEqual({ level: { level: "[CUT]" } });
    expect(JSON.stringify(out.data)).not.toContain(SECRET);
  });

  it("still redacts shallow secrets exactly as before (sanity)", () => {
    const out = redactProcessor()(
      event({ user: "alice", password: "secret", nested: { token: "abc" } }),
      context,
    ) as LogEvent;
    expect(out.data).toEqual({
      user: "alice",
      password: "[REDACTED]",
      nested: { token: "[REDACTED]" },
    });
  });
});
