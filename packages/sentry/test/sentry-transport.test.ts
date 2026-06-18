import { describe, expect, it, vi } from "vitest";
import {
  recordToEvent,
  retryTransport,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
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
  toEvent: recordToEvent,
  reportInternalError() {},
};

describe("sentryTransport", () => {
  it("exposes stable default and custom transport names", () => {
    expect(sentryTransport({ sentry: {} }).name).toBe("sentry");
    expect(sentryTransport({ sentry: {}, name: "errors" }).name).toBe("errors");
  });

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
    expect(info.mock.calls[0]?.[1]).not.toHaveProperty("loggerjs.type");
    expect(info.mock.calls[0]?.[1]).not.toHaveProperty("loggerjs.error");
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
    expect((error as Error).stack).toBe("stacktrace");
    expect(sentryContext).toMatchObject({
      level: "error",
      tags: { route: "/users" },
    });
  });

  it("keeps structured logs and breadcrumbs disabled when requested", () => {
    const info = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["info"]>>();
    const addBreadcrumb = vi.fn<NonNullable<SentryLike["addBreadcrumb"]>>();
    const transport = sentryTransport({
      sentry: { logger: { info }, addBreadcrumb },
      structuredLogs: false,
      breadcrumbs: false,
    });

    transport.log?.(event, context);

    expect(info).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
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

  it("maps Sentry severities and logger methods for warn, trace, and fatal events", () => {
    const trace = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["trace"]>>();
    const warn = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["warn"]>>();
    const error = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["error"]>>();
    const addBreadcrumb = vi.fn<NonNullable<SentryLike["addBreadcrumb"]>>();
    const captureMessage = vi.fn<NonNullable<SentryLike["captureMessage"]>>();
    const transport = sentryTransport({
      sentry: { logger: { trace, warn, error }, addBreadcrumb, captureMessage },
      captureMessages: true,
      eventLevel: "fatal",
    });

    transport.log?.({ ...event, level: 40, levelName: "warn", message: "warned" }, context);
    transport.log?.({ ...event, level: 10, levelName: "trace", message: "traced" }, context);
    transport.log?.({ ...event, level: 60, levelName: "fatal", message: "fataled" }, context);

    expect(warn).toHaveBeenCalledWith("warned", expect.any(Object));
    expect(trace).toHaveBeenCalledWith("traced", expect.any(Object));
    expect(error).toHaveBeenCalledWith("fataled", expect.any(Object));
    expect(addBreadcrumb.mock.calls.map(([crumb]) => crumb.level)).toEqual([
      "warning",
      "debug",
      "fatal",
    ]);
    expect(captureMessage).toHaveBeenCalledWith(
      "fataled",
      expect.objectContaining({ level: "fatal" }),
    );
  });

  it("captures messages only when enabled and preserves default error names", () => {
    const captureMessage = vi.fn<NonNullable<SentryLike["captureMessage"]>>();
    const captureException = vi.fn<NonNullable<SentryLike["captureException"]>>();
    const transport = sentryTransport({
      sentry: { captureMessage, captureException },
      captureMessages: true,
      structuredLogs: false,
      breadcrumbs: false,
    });

    transport.log?.({ ...event, level: 50, levelName: "error", message: "message only" }, context);
    transport.log?.(
      {
        ...event,
        level: 50,
        levelName: "error",
        message: "error only",
        error: { message: "missing name" },
      },
      context,
    );

    expect(captureMessage).toHaveBeenCalledWith(
      "message only",
      expect.objectContaining({
        contexts: {
          loggerjs: expect.objectContaining({
            event_id: "evt-1",
            logger: "api.http",
          }),
        },
      }),
    );
    expect(captureException).toHaveBeenCalledTimes(1);
    const [captured] = captureException.mock.calls[0] ?? [];
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).name).toBe("Error");
    expect((captured as Error).stack).toBeTruthy();
  });

  it("does not capture message events by default", () => {
    const captureMessage = vi.fn<NonNullable<SentryLike["captureMessage"]>>();
    const transport = sentryTransport({
      sentry: { captureMessage },
      structuredLogs: false,
      breadcrumbs: false,
    });

    transport.log?.({ ...event, level: 50, levelName: "error", message: "message only" }, context);

    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("honors minLevel before invoking the Sentry SDK", () => {
    const info = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["info"]>>();
    const addBreadcrumb = vi.fn<NonNullable<SentryLike["addBreadcrumb"]>>();
    const captureMessage = vi.fn<NonNullable<SentryLike["captureMessage"]>>();
    const transport = sentryTransport({
      sentry: { logger: { info }, addBreadcrumb, captureMessage },
      captureMessages: true,
      eventLevel: "debug",
      minLevel: "error",
    });

    transport.log?.(event, context);

    expect(info).not.toHaveBeenCalled();
    expect(addBreadcrumb).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("allows events exactly at minLevel", () => {
    const error = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["error"]>>();
    const captureMessage = vi.fn<NonNullable<SentryLike["captureMessage"]>>();
    const transport = sentryTransport({
      sentry: { logger: { error }, captureMessage },
      captureMessages: true,
      eventLevel: "error",
      minLevel: "error",
    });

    transport.log?.({ ...event, level: 50, levelName: "error", message: "equal" }, context);

    expect(error).toHaveBeenCalledWith("equal", expect.any(Object));
    expect(captureMessage).toHaveBeenCalledWith(
      "equal",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("propagates Sentry SDK failures", () => {
    const error = new Error("sdk unavailable");
    const info = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["info"]>>(() => {
      throw error;
    });
    const transport = sentryTransport({ sentry: { logger: { info } } });

    expect(() => transport.log?.(event, context)).toThrow(error);
  });

  it("can be wrapped with retryTransport for transient SDK failures", async () => {
    const info = vi.fn<NonNullable<NonNullable<SentryLike["logger"]>["info"]>>(() => {
      if (info.mock.calls.length === 1) throw new Error("temporary sdk failure");
    });
    const transport = retryTransport(sentryTransport({ sentry: { logger: { info } } }), {
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
    });

    await transport.log?.(event, context);

    expect(info).toHaveBeenCalledTimes(2);
  });
});
