import { describe, expect, it, vi } from "vitest";
import type { LogEvent, TransportContext } from "@loggerjs/core";
import { sentryTransport, type SentryLike } from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "api.http",
  message: "created",
  tags: { route: "/users" },
  data: { status: 201 },
};

const context: TransportContext = {
  loggerName: "test",
  now: () => 1,
  reportInternalError() {},
};

describe("sentryTransport", () => {
  it("emits structured logs and breadcrumbs", () => {
    const info = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["info"]>>();
    const addBreadcrumb = vi.fn<NonNullable<SentryLike["addBreadcrumb"]>>();
    const sentry: SentryLike = {
      logger: {
        info,
      },
      addBreadcrumb,
    };
    const transport = sentryTransport({ sentry });

    transport.log?.(event, context);

    expect(info).toHaveBeenCalledWith(
      "created",
      expect.objectContaining({
        "loggerjs.event_id": "evt-1",
        "loggerjs.logger": "api.http",
        "loggerjs.data": { status: 201 },
      }),
    );
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "log",
        category: "api.http",
        level: "info",
        message: "created",
      }),
    );
  });

  it("captures serialized errors as Sentry exceptions", () => {
    const captureException = vi.fn<NonNullable<SentryLike["captureException"]>>();
    const transport = sentryTransport({
      sentry: { captureException },
      structuredLogs: false,
      breadcrumbs: false,
    });

    transport.log?.(
      {
        ...event,
        level: 50,
        levelName: "error",
        message: "failed",
        error: {
          name: "TypeError",
          message: "boom",
          stack: "stacktrace",
          code: "ERR_TEST",
        },
      },
      context,
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, sentryContext] = captureException.mock.calls[0] ?? [];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).name).toBe("TypeError");
    expect((error as Error).message).toBe("boom");
    expect(sentryContext).toMatchObject({
      level: "error",
      tags: { route: "/users" },
    });
  });

  it("can disable error event capture", () => {
    const captureException = vi.fn<NonNullable<SentryLike["captureException"]>>();
    const transport = sentryTransport({
      sentry: { captureException },
      captureErrors: false,
      structuredLogs: false,
      breadcrumbs: false,
    });

    transport.log?.(
      {
        ...event,
        level: 50,
        levelName: "error",
        error: {
          message: "boom",
        },
      },
      context,
    );

    expect(captureException).not.toHaveBeenCalled();
  });
});
