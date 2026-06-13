import { createRequire } from "node:module";
import {
  setLoggerDiagnosticSink,
  type LoggerDiagnosticEvent,
  type LoggerDiagnosticSink,
} from "@loggerjs/core";

export interface LoggerDiagnosticsChannelPublisher {
  hasSubscribers?: boolean;
  publish: (message: LoggerDiagnosticEvent) => void;
}

export interface LoggerDiagnosticsChannelModule {
  channel: (name: string) => LoggerDiagnosticsChannelPublisher;
}

export interface InstallLoggerDiagnosticsChannelOptions {
  diagnosticsChannel?: LoggerDiagnosticsChannelModule | null;
  prefix?: string;
}

const requireBuiltin = createRequire(import.meta.url);
let cachedDiagnosticsChannel: LoggerDiagnosticsChannelModule | null | undefined;

function loadDiagnosticsChannel(): LoggerDiagnosticsChannelModule | null {
  if (cachedDiagnosticsChannel !== undefined) return cachedDiagnosticsChannel;
  try {
    cachedDiagnosticsChannel = requireBuiltin(
      "node:diagnostics_channel",
    ) as LoggerDiagnosticsChannelModule;
  } catch {
    try {
      cachedDiagnosticsChannel = requireBuiltin(
        "diagnostics_channel",
      ) as LoggerDiagnosticsChannelModule;
    } catch {
      cachedDiagnosticsChannel = null;
    }
  }
  return cachedDiagnosticsChannel;
}

export function installLoggerDiagnosticsChannel(
  options: InstallLoggerDiagnosticsChannelOptions = {},
): () => void {
  const diagnosticsChannel =
    options.diagnosticsChannel === undefined
      ? loadDiagnosticsChannel()
      : options.diagnosticsChannel;
  if (!diagnosticsChannel) return () => {};

  const prefix = options.prefix ?? "loggerjs";
  const sink: LoggerDiagnosticSink = (event) => {
    const channel = diagnosticsChannel.channel(`${prefix}.${event.stage}`);
    if (channel.hasSubscribers === false) return;
    channel.publish(event);
  };
  const previous = setLoggerDiagnosticSink(sink);

  return () => {
    setLoggerDiagnosticSink(previous);
  };
}
