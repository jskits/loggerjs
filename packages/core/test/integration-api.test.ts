import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  getLoggerMetaStats,
  memoryTransport,
  resetLoggerMetaStats,
  type Integration,
  type IntegrationSetupContext,
} from "../src";

describe("integration API", () => {
  afterEach(() => {
    resetLoggerMetaStats();
  });

  it("captures integration records through the logger pipeline", () => {
    const transport = memoryTransport();
    const integration: Integration = {
      name: "custom",
      setup(api: IntegrationSetupContext) {
        api.capture({
          level: "warn",
          message: "captured by integration",
          props: { feature: "demo" },
        });
      },
    };

    createLogger({
      transports: [transport],
      integrations: [integration],
    });

    expect(transport.events[0]).toMatchObject({
      levelName: "warn",
      logger: "app",
      message: "captured by integration",
      data: { feature: "demo" },
      source: { integration: "integration:custom" },
    });
  });

  it("guards synchronous reentrant integration capture", () => {
    let guarded: (() => void) | undefined;
    let calls = 0;
    const integration: Integration = {
      name: "guarded",
      setup(api: IntegrationSetupContext) {
        guarded = api.guard(() => {
          calls += 1;
          guarded?.();
        });
        guarded();
      },
    };

    createLogger({
      integrations: [integration],
    });

    expect(calls).toBe(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "integration.dropped": 1,
      "integration.dropped.reentrant": 1,
    });
  });

  it("sets up and tears down the same integration instance once", async () => {
    const setup = vi.fn<(api: IntegrationSetupContext) => () => void>(() => teardown);
    const teardown = vi.fn<() => void>();
    const integration: Integration = {
      name: "idempotent",
      setup,
    };

    const logger = createLogger({
      integrations: [integration, integration],
    });
    logger.addIntegration(integration);
    await logger.close();
    await logger.close();

    expect(setup).toHaveBeenCalledTimes(1);
    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
