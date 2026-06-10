import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import {
  diagnosticsChannelIntegration,
  type DiagnosticsChannelModule,
} from "../src/diagnostics-channel-integration";

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
    name: "diagnostics-channel",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function createDiagnosticsChannelModule(): DiagnosticsChannelModule & {
  emit: (name: string, message: unknown) => void;
} {
  const listeners = new Map<string, Array<(message: unknown, name: string) => void>>();
  return {
    subscribe: vi.fn<DiagnosticsChannelModule["subscribe"]>((name, listener) => {
      const items = listeners.get(name) ?? [];
      items.push(listener);
      listeners.set(name, items);
    }),
    unsubscribe: vi.fn<NonNullable<DiagnosticsChannelModule["unsubscribe"]>>((name, listener) => {
      const items = listeners.get(name) ?? [];
      listeners.set(
        name,
        items.filter((item) => item !== listener),
      );
    }),
    emit(name, message) {
      for (const listener of listeners.get(name) ?? []) listener(message, name);
    },
  };
}

describe("diagnosticsChannelIntegration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subscribes to configured diagnostics channels and captures messages", () => {
    const diagnosticsChannel = createDiagnosticsChannelModule();
    const { context, capture } = createIntegrationContext();

    const teardown = diagnosticsChannelIntegration({
      diagnosticsChannel,
      channels: ["undici:request:create", "undici:request:error"],
      captureMessage: true,
    }).setup(context);

    diagnosticsChannel.emit("undici:request:create", {
      request: { method: "GET", origin: "https://api.example.test", path: "/users" },
    });
    diagnosticsChannel.emit("undici:request:error", {
      error: new Error("socket closed"),
    });

    expect(diagnosticsChannel.subscribe).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "diagnostics_channel undici:request:create",
      props: {
        diagnostics: {
          channel: "undici:request:create",
          message: {
            request: {
              method: "GET",
              origin: "https://api.example.test",
              path: "/users",
            },
          },
        },
      },
      source: "integration:diagnostics-channel",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "error",
      message: "diagnostics_channel undici:request:error",
      props: {
        diagnostics: {
          channel: "undici:request:error",
          message: {
            error: expect.objectContaining({
              name: "Error",
              message: "socket closed",
            }),
          },
        },
      },
      source: "integration:diagnostics-channel",
    });

    if (typeof teardown === "function") {
      teardown();
      teardown();
    }
    expect(diagnosticsChannel.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("no-ops when diagnostics_channel is unavailable", () => {
    const { context, capture } = createIntegrationContext();

    const teardown = diagnosticsChannelIntegration({
      diagnosticsChannel: null,
    }).setup(context);

    expect(teardown).toBeUndefined();
    expect(capture).not.toHaveBeenCalled();
  });
});
