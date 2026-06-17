import { describe, expect, it } from "vitest";
import { isLevelEnabled, levelValues, toLevelName, toLevelValue } from "../src";

describe("level helpers", () => {
  it("normalizes named, numeric, missing, and unknown levels", () => {
    expect(toLevelValue("warn")).toBe(levelValues.warn);
    expect(toLevelValue(35)).toBe(35);
    expect(toLevelValue(undefined, levelValues.debug)).toBe(levelValues.debug);
    expect(toLevelValue(null as never, levelValues.trace)).toBe(levelValues.trace);
    expect(toLevelValue("verbose" as never, 35)).toBe(35);
  });

  it("maps numeric levels to the nearest enabled level name", () => {
    expect(toLevelName(Number.POSITIVE_INFINITY)).toBe("fatal");
    expect(toLevelName(levelValues.fatal)).toBe("fatal");
    expect(toLevelName(levelValues.fatal - 1)).toBe("error");
    expect(toLevelName(levelValues.error)).toBe("error");
    expect(toLevelName(levelValues.error - 1)).toBe("warn");
    expect(toLevelName(levelValues.warn)).toBe("warn");
    expect(toLevelName(levelValues.warn - 1)).toBe("info");
    expect(toLevelName(levelValues.info)).toBe("info");
    expect(toLevelName(levelValues.info - 1)).toBe("debug");
    expect(toLevelName(levelValues.debug)).toBe("debug");
    expect(toLevelName(levelValues.debug - 1)).toBe("trace");
    expect(toLevelName(Number.NEGATIVE_INFINITY)).toBe("trace");
  });

  it("checks enabled levels with inclusive thresholds", () => {
    expect(isLevelEnabled("warn", "warn")).toBe(true);
    expect(isLevelEnabled("debug", "info")).toBe(false);
    expect(isLevelEnabled(35, "info")).toBe(true);
    expect(isLevelEnabled("info", 35)).toBe(false);
    expect(isLevelEnabled("fatal", "silent")).toBe(false);
    expect(isLevelEnabled("silent", "fatal")).toBe(true);
  });
});
