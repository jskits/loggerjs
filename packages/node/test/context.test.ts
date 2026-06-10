import { afterEach, describe, expect, it } from "vitest";
import { createLogger, memoryTransport, resetContextManager, withContext } from "@loggerjs/core";
import { installAsyncLocalStorageContext } from "../src";

const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("Node AsyncLocalStorage context", () => {
  let uninstall: (() => void) | undefined;

  afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    resetContextManager();
  });

  it("propagates context across awaits", async () => {
    uninstall = installAsyncLocalStorageContext();
    const transport = memoryTransport();
    const logger = createLogger({ transports: [transport] });

    await withContext({ requestId: "req-1" }, async () => {
      await sleep();
      logger.info("created");
    });

    expect(transport.events[0]?.context).toEqual({ requestId: "req-1" });
  });

  it("keeps concurrent async scopes isolated", async () => {
    uninstall = installAsyncLocalStorageContext();
    const transport = memoryTransport();
    const logger = createLogger({ transports: [transport] });

    await Promise.all([
      withContext({ requestId: "req-a" }, async () => {
        await sleep();
        logger.info("a");
      }),
      withContext({ requestId: "req-b" }, async () => {
        logger.info("b");
        await sleep();
      }),
    ]);

    expect(transport.events.map((event) => [event.message, event.context?.requestId])).toEqual([
      ["b", "req-b"],
      ["a", "req-a"],
    ]);
  });
});
