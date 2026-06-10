import { describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import { queueIntegration, type QueueClientLike } from "../src";

function createLogger(): LoggerLike {
  return {
    log: vi.fn<LoggerLike["log"]>(),
    trace: vi.fn<LoggerLike["trace"]>(),
    debug: vi.fn<LoggerLike["debug"]>(),
    info: vi.fn<LoggerLike["info"]>(),
    warn: vi.fn<LoggerLike["warn"]>(),
    error: vi.fn<LoggerLike["error"]>(),
    fatal: vi.fn<LoggerLike["fatal"]>(),
    captureException: vi.fn<LoggerLike["captureException"]>(),
    event: () => {},
    flush: vi.fn<LoggerLike["flush"]>(async () => {}),
    close: vi.fn<LoggerLike["close"]>(async () => {}),
  };
}

function createIntegrationContext(): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "queue",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

describe("queueIntegration", () => {
  it("captures published queue messages when captureAll is enabled", async () => {
    const client: QueueClientLike = {
      send: vi.fn<(queue: string, payload: unknown) => Promise<unknown>>(async () => ({
        ok: true,
      })),
    };
    const { context, capture } = createIntegrationContext();
    const teardown = queueIntegration({
      captureAll: true,
      capturePayload: true,
      client,
      name: "jobs",
      system: "sqs",
    }).setup(context);

    await (client.send as (queue: string, payload: unknown) => Promise<unknown>)("emails", {
      messageId: "m1",
      to: "user@example.com",
    });

    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Queue publish emails",
      error: undefined,
      props: {
        queue: {
          kind: "jobs",
          system: "sqs",
          queueName: "emails",
          method: "send",
          operation: "publish",
          durationMs: expect.any(Number),
          messageId: "m1",
          payload: {
            messageId: "m1",
            to: "user@example.com",
          },
        },
      },
      source: "integration:queue",
    });

    if (typeof teardown === "function") teardown();
  });

  it("captures queue errors and restores wrapped methods", () => {
    const error = new Error("broker unavailable");
    const originalPublish = vi.fn<(queue: string, payload: unknown) => void>(() => {
      throw error;
    });
    const client: QueueClientLike = {
      publish: originalPublish,
    };
    const { context, capture } = createIntegrationContext();
    const teardown = queueIntegration({ client, system: "rabbitmq" }).setup(context);

    expect(() =>
      (client.publish as (queue: string, payload: unknown) => void)("events", { id: "evt-1" }),
    ).toThrow("broker unavailable");

    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "Queue error publish events",
      error,
      props: {
        queue: {
          kind: "queue",
          system: "rabbitmq",
          queueName: "events",
          method: "publish",
          operation: "publish",
          durationMs: expect.any(Number),
          messageId: "evt-1",
          payload: undefined,
        },
      },
      source: "integration:queue",
    });

    if (typeof teardown === "function") teardown();
    expect(client.publish).toBe(originalPublish);
  });

  it("captures slow consume operations without captureAll", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(100).mockReturnValueOnce(180);
    const client: QueueClientLike = {
      receive: vi.fn<(queue: string) => Promise<unknown>>(async () => ({ id: "m2" })),
    };
    const { context, capture } = createIntegrationContext();
    const teardown = queueIntegration({
      client,
      minDurationMs: 50,
    }).setup(context);

    await (client.receive as (queue: string) => Promise<unknown>)("emails");

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "debug",
        message: "Queue consume emails",
      }),
    );

    if (typeof teardown === "function") teardown();
    now.mockRestore();
  });
});
