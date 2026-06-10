import { createRequire } from "node:module";
import {
  normalizeValue,
  type CaptureInput,
  type Integration,
  type IntegrationSetupContext,
} from "@loggerjs/core";

export interface DiagnosticsChannelModule {
  subscribe: (name: string, listener: (message: unknown, name: string) => void) => void;
  unsubscribe?: (name: string, listener: (message: unknown, name: string) => void) => void;
}

export interface DiagnosticsChannelIntegrationOptions {
  channels?: readonly string[];
  diagnosticsChannel?: DiagnosticsChannelModule | null;
  captureMessage?: boolean;
}

const defaultChannels = [
  "http.client.request.start",
  "http.client.response.finish",
  "http.server.request.start",
  "http.server.response.finish",
  "undici:request:create",
  "undici:request:headers",
  "undici:request:trailers",
  "undici:request:error",
] as const;

const requireBuiltin = createRequire(import.meta.url);
let cachedDiagnosticsChannel: DiagnosticsChannelModule | null | undefined;

export function diagnosticsChannelIntegration(
  options: DiagnosticsChannelIntegrationOptions = {},
): Integration {
  const channels = options.channels ?? defaultChannels;
  const captureMessage = options.captureMessage ?? false;

  return {
    name: "diagnostics-channel",
    setup(api: IntegrationSetupContext) {
      const diagnosticsChannel =
        options.diagnosticsChannel === undefined
          ? loadDiagnosticsChannel()
          : options.diagnosticsChannel;
      if (!diagnosticsChannel) return;

      const disposers: Array<() => void> = [];
      let disposed = false;
      const capture = api.guard((input: CaptureInput) => api.capture(input));

      for (const channel of channels) {
        const listener = (message: unknown, name: string) => {
          capture({
            level: name.endsWith(":error") ? "error" : "debug",
            message: `diagnostics_channel ${name}`,
            props: {
              diagnostics: {
                channel: name,
                message: captureMessage ? normalizeValue(message, { maxDepth: 4 }) : undefined,
              },
            },
          });
        };
        diagnosticsChannel.subscribe(channel, listener);
        disposers.push(() => diagnosticsChannel.unsubscribe?.(channel, listener));
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}

function loadDiagnosticsChannel(): DiagnosticsChannelModule | null {
  if (cachedDiagnosticsChannel !== undefined) return cachedDiagnosticsChannel;
  try {
    cachedDiagnosticsChannel = requireBuiltin(
      "node:diagnostics_channel",
    ) as DiagnosticsChannelModule;
  } catch {
    try {
      cachedDiagnosticsChannel = requireBuiltin("diagnostics_channel") as DiagnosticsChannelModule;
    } catch {
      cachedDiagnosticsChannel = null;
    }
  }
  return cachedDiagnosticsChannel;
}
