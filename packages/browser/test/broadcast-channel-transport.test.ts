import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type LogEvent,
  type TransportContext,
} from "@loggerjs/core";
import { browserBroadcastChannelTransport, type BrowserBroadcastChannelLike } from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "browser",
  message: "ready",
};

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "browser",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

function createChannel() {
  return {
    close: vi.fn<() => void>(),
    postMessage: vi.fn<(message: unknown) => void>(),
  };
}

describe("browserBroadcastChannelTransport", () => {
  afterEach(() => {
    resetLoggerMetaStats();
    vi.restoreAllMocks();
  });

  it("posts default event and batch envelopes", async () => {
    const channel = createChannel();
    const factory = vi.fn<(channelName: string) => BrowserBroadcastChannelLike>(() => channel);
    const transport = browserBroadcastChannelTransport({
      channelName: "loggerjs",
      source: "tab-a",
      channelFactory: factory,
    });
    const context = createContext();

    transport.log?.(event, context);
    transport.logBatch?.([{ ...event, id: "evt-2", seq: 2 }], context);
    await transport.close?.();

    expect(factory).toHaveBeenCalledWith("loggerjs");
    expect(channel.postMessage).toHaveBeenNthCalledWith(1, {
      event,
      source: "tab-a",
      type: "loggerjs.event",
    });
    expect(channel.postMessage).toHaveBeenNthCalledWith(2, {
      events: [{ ...event, id: "evt-2", seq: 2 }],
      source: "tab-a",
      type: "loggerjs.batch",
    });
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it("supports custom message mapping and transport metadata", () => {
    const channel = createChannel();
    const transport = browserBroadcastChannelTransport({
      channelName: "loggerjs",
      name: "bc",
      minLevel: "warn",
      source: "tab-a",
      channelFactory: () => channel,
      mapEvent(item, context) {
        return [context.channelName, context.source, item.message];
      },
      mapBatch(items) {
        return items.map((item) => item.id);
      },
    });

    transport.log?.(event, createContext());
    transport.logBatch?.(
      [
        { ...event, id: "evt-2", seq: 2 },
        { ...event, id: "evt-3", seq: 3 },
      ],
      createContext(),
    );

    expect(transport).toMatchObject({ minLevel: "warn", name: "bc" });
    expect(channel.postMessage).toHaveBeenNthCalledWith(1, ["loggerjs", "tab-a", "ready"]);
    expect(channel.postMessage).toHaveBeenNthCalledWith(2, ["evt-2", "evt-3"]);
  });

  it("reports channel creation failures as dropped events", () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const onError = vi.fn<(error: unknown, detail: unknown) => void>();
    const transport = browserBroadcastChannelTransport({
      channelName: "loggerjs",
      channelFactory() {
        throw new Error("unsupported");
      },
      onError,
    });

    transport.log?.(event, createContext(errors));

    expect(errors).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      droppedEvents: 1,
      operation: "create-channel",
    });
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.create-channel": 1,
    });
  });

  it("reports post failures with batch drop counts", () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const channel: BrowserBroadcastChannelLike = {
      postMessage() {
        throw new Error("quota exceeded");
      },
    };
    const transport = browserBroadcastChannelTransport({
      channelName: "loggerjs",
      channelFactory: () => channel,
    });

    transport.logBatch?.(
      [
        { ...event, id: "evt-2", seq: 2 },
        { ...event, id: "evt-3", seq: 3 },
      ],
      createContext(errors),
    );

    expect(errors).toHaveLength(1);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 2,
      "transport.dropped.post-message": 2,
    });
  });
});
