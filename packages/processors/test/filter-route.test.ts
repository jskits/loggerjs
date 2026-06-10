import { describe, expect, it, vi } from "vitest";
import { getLogEventRoute, type LogEvent, type ProcessorContext } from "@loggerjs/core";
import { filterProcessor, routeProcessor } from "../src/filter-route";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "app.http",
  message: "request finished",
  type: "http.request",
  tags: { tenant: "acme", noisy: true },
  source: { integration: "integration:fetch", runtime: "browser" },
};

const context: ProcessorContext = {
  loggerName: "app",
  now: () => 1,
  reportInternalError() {},
};

describe("filterProcessor", () => {
  it("keeps events when a predicate returns true and drops false", () => {
    expect(filterProcessor(() => true)(event, context)).toBe(event);
    expect(filterProcessor(() => false)(event, context)).toBe(false);
  });

  it("supports rule based drop and allowlist filtering", () => {
    const onDrop = vi.fn<(item: LogEvent, reason: string) => void>();
    const dropNoisy = filterProcessor({
      rules: [{ tags: { noisy: true }, reason: "noisy" }],
      onDrop,
    });

    expect(dropNoisy(event, context)).toBe(false);
    expect(onDrop).toHaveBeenCalledWith(event, "noisy");

    const allowHttp = filterProcessor({
      rules: [{ type: "http.request", action: "keep" }],
      defaultAction: "drop",
    });

    expect(allowHttp(event, context)).toBe(event);
    expect(allowHttp({ ...event, type: "audit" }, context)).toBe(false);
  });
});

describe("routeProcessor", () => {
  it("attaches a static transport route", () => {
    const routed = routeProcessor({ transports: ["remote"] })(event, context) as LogEvent;

    expect(getLogEventRoute(routed)).toEqual({ transports: ["remote"] });
    expect(Object.keys(routed)).not.toContain("__loggerjsRoute");
  });

  it("attaches the first matching rule route", () => {
    const routed = routeProcessor([
      { tags: { tenant: "other" }, transports: ["other"] },
      {
        logger: /^app\./,
        integration: "integration:fetch",
        runtime: "browser",
        levelName: "info",
        transports: ["browser-http"],
        excludeTransports: ["console"],
      },
    ])(event, context) as LogEvent;

    expect(getLogEventRoute(routed)).toEqual({
      transports: ["browser-http"],
      excludeTransports: ["console"],
    });
  });
});
