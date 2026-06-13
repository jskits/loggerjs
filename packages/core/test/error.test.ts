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
});
