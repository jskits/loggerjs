import { describe, expect, it } from "vitest";
import type { LogEvent, ProcessorContext } from "@loggerjs/core";
import { levelOverrideProcessor } from "../src/level-override";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "app.http",
  message: "request failed",
  type: "http.request",
  tags: { route: "/checkout", tenant: "acme" },
  source: { integration: "integration:fetch", runtime: "browser" },
};

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

describe("levelOverrideProcessor", () => {
  it("overrides levels from a callback", () => {
    const processor = levelOverrideProcessor((item) =>
      item.message.includes("failed") ? "error" : undefined,
    );

    expect(processor(event, context)).toMatchObject({
      level: 50,
      levelName: "error",
    });
  });

  it("matches declarative rules by logger, type, source, tags, and level range", () => {
    const processor = levelOverrideProcessor([
      {
        logger: /^app\./,
        type: "http.request",
        integration: "integration:fetch",
        runtime: "browser",
        tags: { tenant: "acme" },
        minLevel: "debug",
        maxLevel: "info",
        level: "warn",
      },
    ]);

    expect(processor(event, context)).toMatchObject({
      level: 40,
      levelName: "warn",
    });
  });

  it("leaves unmatched events unchanged", () => {
    const processor = levelOverrideProcessor([{ tags: { tenant: "other" }, level: "fatal" }]);

    expect(processor(event, context)).toBe(event);
  });

  it("drops events when the override is silent or false", () => {
    expect(levelOverrideProcessor("silent")(event, context)).toBe(false);
    expect(levelOverrideProcessor(() => false)(event, context)).toBe(false);
  });
});
