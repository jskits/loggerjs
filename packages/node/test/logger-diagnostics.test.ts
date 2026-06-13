import { afterEach, describe, expect, it, vi } from "vitest";
import { emitLoggerDiagnostic, setLoggerDiagnosticSink } from "@loggerjs/core";
import {
  installLoggerDiagnosticsChannel,
  type LoggerDiagnosticsChannelModule,
  type LoggerDiagnosticsChannelPublisher,
} from "../src";

function createDiagnosticsChannelModule(hasSubscribers = true): {
  diagnosticsChannel: LoggerDiagnosticsChannelModule;
  publishers: Map<
    string,
    LoggerDiagnosticsChannelPublisher & { publish: ReturnType<typeof vi.fn> }
  >;
} {
  const publishers = new Map<
    string,
    LoggerDiagnosticsChannelPublisher & { publish: ReturnType<typeof vi.fn> }
  >();
  const diagnosticsChannel: LoggerDiagnosticsChannelModule = {
    channel(name) {
      let publisher = publishers.get(name);
      if (!publisher) {
        publisher = {
          hasSubscribers,
          publish: vi.fn<(message: unknown) => void>(),
        };
        publishers.set(name, publisher);
      }
      return publisher;
    },
  };
  return { diagnosticsChannel, publishers };
}

describe("installLoggerDiagnosticsChannel", () => {
  afterEach(() => {
    setLoggerDiagnosticSink(undefined);
  });

  it("publishes logger diagnostics to stage-specific channels", () => {
    const { diagnosticsChannel, publishers } = createDiagnosticsChannelModule();
    const teardown = installLoggerDiagnosticsChannel({ diagnosticsChannel });

    emitLoggerDiagnostic({ stage: "dispatch", phase: "start", logger: "app" });

    expect(publishers.get("loggerjs.dispatch")?.publish).toHaveBeenCalledWith({
      stage: "dispatch",
      phase: "start",
      logger: "app",
    });

    teardown();
  });

  it("skips publish when the diagnostics channel has no subscribers", () => {
    const { diagnosticsChannel, publishers } = createDiagnosticsChannelModule(false);
    const teardown = installLoggerDiagnosticsChannel({ diagnosticsChannel });

    emitLoggerDiagnostic({ stage: "transport", phase: "start", transport: "stdout" });

    expect(publishers.get("loggerjs.transport")?.publish).not.toHaveBeenCalled();

    teardown();
  });

  it("restores the previous diagnostics sink on teardown", () => {
    const events: unknown[] = [];
    setLoggerDiagnosticSink((event) => events.push(event));
    const { diagnosticsChannel } = createDiagnosticsChannelModule();
    const teardown = installLoggerDiagnosticsChannel({ diagnosticsChannel });

    teardown();
    emitLoggerDiagnostic({ stage: "flush", phase: "start" });

    expect(events).toEqual([{ stage: "flush", phase: "start" }]);
  });
});
