import { describe, expect, it } from "vitest";
import { normalizeError } from "../src";

describe("error utils", () => {
  it("keeps normalized object error fields after copying enumerable properties", () => {
    const normalized = normalizeError(
      {
        name: 42,
        message: { detail: "not a string" },
        stack: "line 1\nline 2\nline 3",
        code: "E_CUSTOM",
      },
      { maxStackLines: 2 },
    );

    expect(normalized).toMatchObject({
      name: undefined,
      message: "[object Object]",
      stack: "line 1\nline 2",
      code: "E_CUSTOM",
    });
  });

  it("normalizes Error causes so native JSON.stringify keeps the chain", () => {
    const root = new RangeError("root cause");
    const middle = Object.assign(new Error("middle"), { cause: root });
    const top = Object.assign(new TypeError("top"), { cause: middle });

    const encoded = JSON.parse(JSON.stringify(normalizeError(top))) as Record<string, unknown>;

    expect(encoded).toMatchObject({
      name: "TypeError",
      message: "top",
      cause: {
        name: "Error",
        message: "middle",
        cause: { name: "RangeError", message: "root cause" },
      },
    });
  });

  it("marks circular causes and bounds deep cause chains", () => {
    const first = new Error("first");
    const second = Object.assign(new Error("second"), { cause: first });
    Object.assign(first, { cause: second });
    expect(normalizeError(first).cause).toMatchObject({ message: "second", cause: "[Circular]" });

    let deep: Error = new Error("depth 0");
    for (let index = 1; index <= 20; index += 1) {
      deep = Object.assign(new Error(`depth ${index}`), { cause: deep });
    }
    let level: unknown = normalizeError(deep);
    let depth = 0;
    while (level && typeof level === "object" && "cause" in level) {
      level = (level as { cause: unknown }).cause;
      depth += 1;
    }
    expect(depth).toBe(9);
    expect(level).toEqual({ name: "Error", message: "depth 11" });
  });

  it("keeps non-Error causes as they are", () => {
    const error = Object.assign(new Error("wrapped"), { cause: { code: "E_UPSTREAM" } });
    expect(normalizeError(error).cause).toEqual({ code: "E_UPSTREAM" });
  });
});
