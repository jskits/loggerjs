import {
  normalizeValue,
  type Integration,
  type IntegrationSetupContext,
  type LoggerLevel,
} from "@loggerjs/core";

export interface BrowserExtensionEventLike<TListener extends (...args: never[]) => unknown> {
  addListener?: (listener: TListener) => void;
  removeListener?: (listener: TListener) => void;
}

export interface BrowserExtensionRuntimeLike {
  id?: string;
  getManifest?: () => { name?: string; version?: string };
  onMessage?: BrowserExtensionEventLike<
    (message: unknown, sender?: BrowserExtensionMessageSenderLike) => unknown
  >;
  onInstalled?: BrowserExtensionEventLike<(details: unknown) => void>;
}

export interface BrowserExtensionMessageSenderLike {
  id?: string;
  origin?: string;
  url?: string;
  tab?: {
    id?: number;
    url?: string;
  };
}

export interface ElectronIpcRendererLike {
  on?: (channel: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (channel: string, listener: (...args: unknown[]) => void) => unknown;
  removeListener?: (channel: string, listener: (...args: unknown[]) => void) => unknown;
  send?: (channel: string, ...args: unknown[]) => void;
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

export interface CaptureRuntimeHostOptions {
  level?: LoggerLevel;
  captureExtensionMessages?: boolean;
  captureExtensionInstalled?: boolean;
  captureExtensionMessageData?: boolean;
  captureElectronMessages?: boolean;
  captureElectronSend?: boolean;
  captureElectronInvoke?: boolean;
  captureElectronMessageData?: boolean;
  electronChannels?: readonly string[];
  extensionRuntime?: BrowserExtensionRuntimeLike;
  ipcRenderer?: ElectronIpcRendererLike;
  sanitizeUrl?: (url: string) => string;
}

const textEncoder = new TextEncoder();

function byteLength(value: unknown): number | undefined {
  if (typeof value === "string") return textEncoder.encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return undefined;
}

function valueSummary(value: unknown, includeData: boolean): Record<string, unknown> {
  return {
    dataType:
      typeof value === "object" && value
        ? ((value as { constructor?: { name?: string } }).constructor?.name ?? "object")
        : typeof value,
    byteLength: byteLength(value),
    data: includeData ? normalizeValue(value, { maxDepth: 4, maxObjectKeys: 80 }) : undefined,
  };
}

function senderInfo(
  sender: BrowserExtensionMessageSenderLike | undefined,
  sanitizeUrl: ((url: string) => string) | undefined,
) {
  if (!sender) return undefined;
  const sanitize = (url: string | undefined) => (url && sanitizeUrl ? sanitizeUrl(url) : url);
  return {
    id: sender.id,
    origin: sender.origin,
    url: sanitize(sender.url),
    tab: sender.tab
      ? {
          id: sender.tab.id,
          url: sanitize(sender.tab.url),
        }
      : undefined,
  };
}

function defaultExtensionRuntime(): BrowserExtensionRuntimeLike | undefined {
  const global = globalThis as unknown as {
    browser?: { runtime?: BrowserExtensionRuntimeLike };
    chrome?: { runtime?: BrowserExtensionRuntimeLike };
  };
  return global.browser?.runtime ?? global.chrome?.runtime;
}

function defaultIpcRenderer(): ElectronIpcRendererLike | undefined {
  const global = globalThis as unknown as {
    electron?: { ipcRenderer?: ElectronIpcRendererLike };
    require?: (id: string) => unknown;
  };
  if (global.electron?.ipcRenderer) return global.electron.ipcRenderer;
  try {
    return (global.require?.("electron") as { ipcRenderer?: ElectronIpcRendererLike } | undefined)
      ?.ipcRenderer;
  } catch {
    return undefined;
  }
}

export function captureRuntimeHostIntegration(
  options: CaptureRuntimeHostOptions = {},
): Integration {
  const level = options.level ?? "debug";
  const captureExtensionMessages = options.captureExtensionMessages ?? true;
  const captureExtensionInstalled = options.captureExtensionInstalled ?? true;
  const captureExtensionMessageData = options.captureExtensionMessageData ?? false;
  const captureElectronMessages = options.captureElectronMessages ?? true;
  const captureElectronSend = options.captureElectronSend ?? true;
  const captureElectronInvoke = options.captureElectronInvoke ?? true;
  const captureElectronMessageData = options.captureElectronMessageData ?? false;
  const electronChannels = options.electronChannels ?? [];

  return {
    name: "capture-runtime-host",
    setup(api: IntegrationSetupContext) {
      const extensionRuntime = options.extensionRuntime ?? defaultExtensionRuntime();
      const ipcRenderer = options.ipcRenderer ?? defaultIpcRenderer();
      const disposers: Array<() => void> = [];
      let disposed = false;

      const capture = api.guard((input: Parameters<IntegrationSetupContext["capture"]>[0]) => {
        if (!disposed) api.capture(input);
      });

      if (extensionRuntime) {
        const manifest = extensionRuntime.getManifest?.();

        if (captureExtensionMessages && extensionRuntime.onMessage?.addListener) {
          const onMessage = (message: unknown, sender?: BrowserExtensionMessageSenderLike) => {
            capture({
              level,
              message: "Browser extension message",
              props: {
                browser: {
                  kind: "extension-message",
                  extension: {
                    id: extensionRuntime.id,
                    name: manifest?.name,
                    version: manifest?.version,
                  },
                  message: valueSummary(message, captureExtensionMessageData),
                  sender: senderInfo(sender, options.sanitizeUrl),
                },
              },
            });
          };
          extensionRuntime.onMessage.addListener(onMessage as never);
          disposers.push(() => extensionRuntime.onMessage?.removeListener?.(onMessage as never));
        }

        if (captureExtensionInstalled && extensionRuntime.onInstalled?.addListener) {
          const onInstalled = (details: unknown) => {
            capture({
              level,
              message: "Browser extension installed",
              props: {
                browser: {
                  kind: "extension-installed",
                  extension: {
                    id: extensionRuntime.id,
                    name: manifest?.name,
                    version: manifest?.version,
                  },
                  details: normalizeValue(details, { maxDepth: 4, maxObjectKeys: 80 }),
                },
              },
            });
          };
          extensionRuntime.onInstalled.addListener(onInstalled as never);
          disposers.push(() =>
            extensionRuntime.onInstalled?.removeListener?.(onInstalled as never),
          );
        }
      }

      if (ipcRenderer) {
        if (captureElectronMessages && ipcRenderer.on) {
          for (const channel of electronChannels) {
            const listener = (_event: unknown, ...args: unknown[]) => {
              capture({
                level,
                message: `Electron IPC message ${channel}`,
                props: {
                  browser: {
                    kind: "electron-ipc",
                    direction: "incoming",
                    channel,
                    args: args.map((arg) => valueSummary(arg, captureElectronMessageData)),
                  },
                },
              });
            };
            ipcRenderer.on(channel, listener);
            disposers.push(() => {
              if (ipcRenderer.off) ipcRenderer.off(channel, listener);
              else ipcRenderer.removeListener?.(channel, listener);
            });
          }
        }

        if (captureElectronSend && ipcRenderer.send) {
          const originalSend = ipcRenderer.send;
          ipcRenderer.send = (channel: string, ...args: unknown[]) => {
            capture({
              level,
              message: `Electron IPC send ${channel}`,
              props: {
                browser: {
                  kind: "electron-ipc",
                  direction: "outgoing",
                  channel,
                  args: args.map((arg) => valueSummary(arg, captureElectronMessageData)),
                },
              },
            });
            return originalSend.call(ipcRenderer, channel, ...args);
          };
          disposers.push(() => {
            ipcRenderer.send = originalSend;
          });
        }

        if (captureElectronInvoke && ipcRenderer.invoke) {
          const originalInvoke = ipcRenderer.invoke;
          ipcRenderer.invoke = (channel: string, ...args: unknown[]) => {
            capture({
              level,
              message: `Electron IPC invoke ${channel}`,
              props: {
                browser: {
                  kind: "electron-ipc",
                  direction: "invoke",
                  channel,
                  args: args.map((arg) => valueSummary(arg, captureElectronMessageData)),
                },
              },
            });
            return originalInvoke.call(ipcRenderer, channel, ...args);
          };
          disposers.push(() => {
            ipcRenderer.invoke = originalInvoke;
          });
        }
      }

      return () => {
        if (disposed) return;
        disposed = true;
        for (const dispose of disposers) dispose();
      };
    },
  };
}
