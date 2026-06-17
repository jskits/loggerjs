import { describe, expect, it } from "vitest";
import {
  getLogEventRoute,
  LOGGERJS_ROUTE,
  withLogEventRoute,
  type LogEvent,
  type RoutableLogEvent,
} from "../src";

function createEvent(): LogEvent {
  return {
    id: "evt-1",
    time: 10,
    seq: 2,
    level: 30,
    levelName: "info",
    logger: "api",
    message: "created",
  };
}

describe("event route metadata", () => {
  it("merges route metadata without duplicating transport names", () => {
    const event = createEvent();
    const routed = withLogEventRoute(event, { transports: ["remote"] });
    const excluded = withLogEventRoute(routed, { excludeTransports: ["console"] });
    const merged = withLogEventRoute(excluded, {
      transports: ["remote", "audit"],
      excludeTransports: ["console", "debug"],
    });

    expect(getLogEventRoute(event)).toBeUndefined();
    expect(getLogEventRoute(routed)).toEqual({ transports: ["remote"] });
    expect(getLogEventRoute(excluded)).toEqual({
      transports: ["remote"],
      excludeTransports: ["console"],
    });
    expect(getLogEventRoute(merged)).toEqual({
      transports: ["remote", "audit"],
      excludeTransports: ["console", "debug"],
    });
  });

  it("stores route metadata as configurable non-enumerable event state", () => {
    const routed = withLogEventRoute(createEvent(), { transports: ["remote"] });
    const descriptor = Object.getOwnPropertyDescriptor(routed, LOGGERJS_ROUTE);

    expect(Object.keys(routed)).not.toContain(LOGGERJS_ROUTE);
    expect(descriptor).toMatchObject({
      configurable: true,
      enumerable: false,
      value: { transports: ["remote"] },
    });

    Object.defineProperty(routed, LOGGERJS_ROUTE, {
      configurable: true,
      enumerable: false,
      value: { transports: ["override"] },
    });

    expect(getLogEventRoute(routed as RoutableLogEvent)).toEqual({ transports: ["override"] });
  });
});
