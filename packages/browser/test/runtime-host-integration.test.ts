import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationSetupContext,
  type CaptureInput,
  type IntegrationSetupContext,
  type LoggerLike,
} from "@loggerjs/core";
import {
  captureRuntimeHostIntegration,
  type BrowserExtensionRuntimeLike,
  type ElectronIpcRendererLike,
} from "../src";

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

function createIntegrationContext(): {
  context: IntegrationSetupContext;
  capture: ReturnType<typeof vi.fn<(input: CaptureInput) => void>>;
} {
  const logger = createLogger();
  const capture = vi.fn<(input: CaptureInput) => void>();
  const context = createIntegrationSetupContext({
    name: "capture-runtime-host",
    logger,
    capture,
    getLogger: () => logger,
  });
  return { context, capture };
}

function eventSlot<TListener extends (...args: never[]) => unknown>() {
  const listeners: TListener[] = [];
  return {
    listeners,
    addListener(listener: TListener) {
      listeners.push(listener);
    },
    removeListener(listener: TListener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  };
}

describe("captureRuntimeHostIntegration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("captures browser extension runtime events without message data by default", () => {
    const onMessage =
      eventSlot<
        (message: unknown, sender?: { tab?: { id?: number; url?: string }; url?: string }) => void
      >();
    const onInstalled = eventSlot<(details: unknown) => void>();
    const extensionRuntime: BrowserExtensionRuntimeLike = {
      id: "ext-1",
      getManifest: () => ({ name: "Logger", version: "1.0.0" }),
      onInstalled,
      onMessage,
    };
    const { context, capture } = createIntegrationContext();
    const teardown = captureRuntimeHostIntegration({
      extensionRuntime,
      sanitizeUrl: (url) => url.replace(/token=[^&]+/, "token=[redacted]"),
    }).setup(context);

    onMessage.listeners[0]?.("secret message", {
      tab: { id: 1, url: "https://app.example?token=secret" },
      url: "https://content.example?token=secret",
    });
    onInstalled.listeners[0]?.({ reason: "install" });

    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Browser extension message",
      props: {
        browser: {
          kind: "extension-message",
          extension: { id: "ext-1", name: "Logger", version: "1.0.0" },
          message: {
            byteLength: 14,
            data: undefined,
            dataType: "string",
          },
          sender: {
            id: undefined,
            origin: undefined,
            tab: { id: 1, url: "https://app.example?token=[redacted]" },
            url: "https://content.example?token=[redacted]",
          },
        },
      },
      source: "integration:capture-runtime-host",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Browser extension installed",
      props: {
        browser: {
          kind: "extension-installed",
          extension: { id: "ext-1", name: "Logger", version: "1.0.0" },
          details: { reason: "install" },
        },
      },
      source: "integration:capture-runtime-host",
    });

    if (typeof teardown === "function") teardown();
    expect(onMessage.listeners).toHaveLength(0);
    expect(onInstalled.listeners).toHaveLength(0);
  });

  it("captures Electron ipcRenderer messages and restores patched methods", async () => {
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const originalSend = vi.fn<(channel: string, ...args: unknown[]) => void>();
    const originalInvoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(
      async () => "ok",
    );
    const ipcRenderer: ElectronIpcRendererLike = {
      invoke: originalInvoke,
      send: originalSend,
      on(channel, listener) {
        const items = listeners.get(channel) ?? [];
        items.push(listener);
        listeners.set(channel, items);
      },
      off(channel, listener) {
        const items = listeners.get(channel) ?? [];
        listeners.set(
          channel,
          items.filter((item) => item !== listener),
        );
      },
    };
    const { context, capture } = createIntegrationContext();
    const teardown = captureRuntimeHostIntegration({
      electronChannels: ["main:error"],
      ipcRenderer,
    }).setup(context);

    ipcRenderer.send?.("renderer:ready", "secret");
    await ipcRenderer.invoke?.("config:get", { token: "secret" });
    listeners.get("main:error")?.[0]?.({}, "boom");

    expect(originalSend).toHaveBeenCalledWith("renderer:ready", "secret");
    expect(originalInvoke).toHaveBeenCalledWith("config:get", { token: "secret" });
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Electron IPC send renderer:ready",
      props: {
        browser: {
          kind: "electron-ipc",
          direction: "outgoing",
          channel: "renderer:ready",
          args: [{ byteLength: 6, data: undefined, dataType: "string" }],
        },
      },
      source: "integration:capture-runtime-host",
    });
    expect(capture).toHaveBeenCalledWith({
      level: "debug",
      message: "Electron IPC message main:error",
      props: {
        browser: {
          kind: "electron-ipc",
          direction: "incoming",
          channel: "main:error",
          args: [{ byteLength: 4, data: undefined, dataType: "string" }],
        },
      },
      source: "integration:capture-runtime-host",
    });

    if (typeof teardown === "function") teardown();
    expect(ipcRenderer.send).toBe(originalSend);
    expect(ipcRenderer.invoke).toBe(originalInvoke);
    expect(listeners.get("main:error")).toHaveLength(0);
  });
});
