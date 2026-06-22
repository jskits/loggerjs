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
    ready: vi.fn<LoggerLike["ready"]>(async () => {}),
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

  it("keeps Prisma integration scoped to raw query methods", async () => {
    const findMany = vi.fn<() => Promise<unknown[]>>(async () => [{ id: 1 }]);
    const client = {
      $on: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(),
      $queryRawUnsafe: vi.fn<(statement: string) => Promise<unknown>>(async () => []),
      user: {
        findMany,
      },
    };
    const { context, capture } = createContext("prisma");

    prismaIntegration({ client, captureAll: true }).setup(context);

    await client.user.findMany();

    expect(client.$on).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
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

  it("classifies BullMQ addBulk as publish", async () => {
    const client = {
      name: "emails",
      addBulk: vi.fn<(jobs: unknown[]) => Promise<unknown>>(async () => [
        { id: "job-1" },
        { id: "job-2" },
      ]),
    };
    const { context, capture } = createContext("bullmq");
    bullMqIntegration({ client, captureAll: true, capturePayload: true }).setup(context);

    await client.addBulk([
      { data: { id: "job-1" }, name: "welcome" },
      { data: { id: "job-2" }, name: "receipt" },
    ]);

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Queue publish emails",
        props: {
          queue: expect.objectContaining({
            kind: "bullmq",
            method: "addBulk",
            operation: "publish",
            payload: [
              { data: { id: "job-1" }, name: "welcome" },
              { data: { id: "job-2" }, name: "receipt" },
            ],
            queueName: "emails",
            system: "bullmq",
          }),
        },
      }),
    );
  });

  it("wraps legacy BullMQ process methods as consume operations", () => {
    const client = {
      name: "emails",
      process: vi.fn<(name: string, handler: () => void) => void>(),
    };
    const { context, capture } = createContext("bullmq");
    bullMqIntegration({ client, captureAll: true }).setup(context);

    client.process("welcome", () => {});

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Queue consume welcome",
        props: {
          queue: expect.objectContaining({
            kind: "bullmq",
            method: "process",
            operation: "consume",
            queueName: "welcome",
            system: "bullmq",
          }),
        },
      }),
    );
  });

  it("does not hook BullMQ Worker or QueueEvents lifecycle listeners", () => {
    const client = {
      name: "emails",
      add: vi.fn<(name: string, payload: unknown) => Promise<unknown>>(async () => ({
        id: "job-1",
      })),
      off: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(),
      on: vi.fn<(event: string, listener: (...args: unknown[]) => void) => void>(),
    };
    const { context } = createContext("bullmq");

    bullMqIntegration({ client, captureAll: true }).setup(context);

    expect(client.on).not.toHaveBeenCalled();
    expect(client.off).not.toHaveBeenCalled();
  });
});
