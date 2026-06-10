import { afterEach, describe, expect, it, vi } from "vitest";
import { configure, getLogger, memoryTransport, resetLoggerRegistry, type Transport } from "../src";

describe("logger registry", () => {
  afterEach(async () => {
    await resetLoggerRegistry();
  });

  it("returns a void logger before configuration", () => {
    const logger = getLogger(["library", "parser"]);

    expect(() => logger.info("not configured")).not.toThrow();
  });

  it("routes configured category prefixes to selected transports and levels", async () => {
    const consoleTransport = memoryTransport({ name: "console" });
    const httpTransport = memoryTransport({ name: "http" });

    await configure({
      level: "warn",
      transports: {
        console: consoleTransport,
        http: httpTransport,
      },
      loggers: [
        {
          category: ["api"],
          level: "debug",
          transports: ["http"],
        },
        {
          category: ["web"],
          transports: ["console"],
        },
      ],
    });

    getLogger(["api", "orders"]).debug("order debug");
    getLogger(["web"]).info("page loaded");
    getLogger(["web"]).warn("page slow");

    expect(httpTransport.events.map((event) => event.message)).toEqual(["order debug"]);
    expect(consoleTransport.events.map((event) => event.message)).toEqual(["page slow"]);
  });

  it("closes previous transports on reset", async () => {
    const close = vi.fn<() => Promise<void>>(async () => {});
    const transport: Transport = {
      name: "custom",
      close,
    };

    await configure({
      transports: { custom: transport },
    });
    await configure({ reset: true });

    expect(close).toHaveBeenCalledTimes(1);
  });
});
