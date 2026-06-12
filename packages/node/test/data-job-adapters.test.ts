import { describe, expect, it, vi } from "vitest";
import { createIntegrationSetupContext, type CaptureInput, type LoggerLike } from "@loggerjs/core";
import { bullMqIntegration, prismaIntegration, redisIntegration } from "../src";

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

function createContext(name: string) {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  return {
    capture,
    context: createIntegrationSetupContext({
      name,
      logger,
      capture,
      getLogger: () => logger,
    }),
  };
}

describe("data and job adapters", () => {
  it("wraps Prisma raw query methods", async () => {
    const client = {
      $queryRawUnsafe: vi.fn<(statement: string) => Promise<unknown>>(async () => []),
    };
    const { context, capture } = createContext("prisma");
    prismaIntegration({ client, captureAll: true }).setup(context);

    await client.$queryRawUnsafe("select 1");

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Database $queryRawUnsafe select 1",
        props: { db: expect.objectContaining({ kind: "prisma", system: "prisma" }) },
      }),
    );
  });

  it("wraps Redis command methods", async () => {
    const client = {
      get: vi.fn<(key: string) => Promise<string>>(async () => "value"),
    };
    const { context, capture } = createContext("redis");
    redisIntegration({ client, captureAll: true }).setup(context);

    await client.get("session:1");

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Database get GET session:1",
        props: { db: expect.objectContaining({ kind: "redis", system: "redis" }) },
      }),
    );
  });

  it("wraps BullMQ queue methods", async () => {
    const client = {
      name: "emails",
      add: vi.fn<(name: string, payload: unknown) => Promise<unknown>>(async () => ({
        id: "job-1",
      })),
    };
    const { context, capture } = createContext("bullmq");
    bullMqIntegration({ client, captureAll: true, capturePayload: true }).setup(context);

    await client.add("welcome", { id: "job-1" });

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Queue publish welcome",
        props: { queue: expect.objectContaining({ kind: "bullmq", system: "bullmq" }) },
      }),
    );
  });
});
