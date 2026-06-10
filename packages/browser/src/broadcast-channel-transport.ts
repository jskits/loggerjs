import {
  incrementLoggerMetaCounter,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";

export interface BrowserBroadcastChannelLike {
  postMessage: (message: unknown) => void;
  close?: () => void;
}

export type BrowserBroadcastChannelFactory = (channelName: string) => BrowserBroadcastChannelLike;

export interface BrowserBroadcastChannelEventMessage {
  type: "loggerjs.event";
  source: string;
  event: LogEvent;
}

export interface BrowserBroadcastChannelBatchMessage {
  type: "loggerjs.batch";
  source: string;
  events: readonly LogEvent[];
}

export type BrowserBroadcastChannelMessage =
  | BrowserBroadcastChannelEventMessage
  | BrowserBroadcastChannelBatchMessage;

export interface BrowserBroadcastChannelMapContext {
  channelName: string;
  source: string;
}

export interface BrowserBroadcastChannelErrorDetail {
  operation: "create-channel" | "post-message" | "close-channel" | "on-error";
  droppedEvents: number;
}

export interface BrowserBroadcastChannelTransportOptions {
  channelName: string;
  name?: string;
  source?: string;
  minLevel?: LoggerLevel;
  channelFactory?: BrowserBroadcastChannelFactory;
  closeChannelOnClose?: boolean;
  mapEvent?: (event: LogEvent, context: BrowserBroadcastChannelMapContext) => unknown;
  mapBatch?: (events: readonly LogEvent[], context: BrowserBroadcastChannelMapContext) => unknown;
  onError?: (error: unknown, detail: BrowserBroadcastChannelErrorDetail) => void;
}

let sourceSequence = 0;

function createSourceId() {
  sourceSequence += 1;
  return `loggerjs-${Date.now().toString(36)}-${sourceSequence.toString(36)}`;
}

function defaultChannelFactory(channelName: string): BrowserBroadcastChannelLike {
  if (typeof BroadcastChannel === "undefined") {
    throw new Error("BroadcastChannel is not available");
  }
  return new BroadcastChannel(channelName);
}

function defaultMapEvent(
  event: LogEvent,
  context: BrowserBroadcastChannelMapContext,
): BrowserBroadcastChannelEventMessage {
  return { type: "loggerjs.event", source: context.source, event };
}

function defaultMapBatch(
  events: readonly LogEvent[],
  context: BrowserBroadcastChannelMapContext,
): BrowserBroadcastChannelBatchMessage {
  return { type: "loggerjs.batch", source: context.source, events };
}

export function browserBroadcastChannelTransport(
  options: BrowserBroadcastChannelTransportOptions,
): Transport {
  const transportName = options.name ?? "browser-broadcast-channel";
  const source = options.source ?? createSourceId();
  const mapContext: BrowserBroadcastChannelMapContext = {
    channelName: options.channelName,
    source,
  };
  const mapEvent = options.mapEvent ?? defaultMapEvent;
  const mapBatch = options.mapBatch ?? defaultMapBatch;
  const channelFactory = options.channelFactory ?? defaultChannelFactory;
  const closeChannelOnClose = options.closeChannelOnClose ?? true;
  let channel: BrowserBroadcastChannelLike | undefined;
  let closed = false;

  const reportError = (
    error: unknown,
    context: TransportContext | undefined,
    detail: BrowserBroadcastChannelErrorDetail,
  ) => {
    if (detail.droppedEvents > 0) {
      incrementLoggerMetaCounter("transport.dropped", detail.droppedEvents);
      incrementLoggerMetaCounter(`transport.dropped.${detail.operation}`, detail.droppedEvents);
    }

    try {
      options.onError?.(error, detail);
    } catch (onErrorError) {
      context?.reportInternalError(onErrorError, {
        operation: "on-error",
        phase: "transport",
        transport: transportName,
      });
    }

    context?.reportInternalError(error, {
      operation: detail.operation,
      phase: "transport",
      transport: transportName,
    });
  };

  const getChannel = (context: TransportContext) => {
    if (closed) return undefined;
    if (channel) return channel;
    try {
      channel = channelFactory(options.channelName);
      return channel;
    } catch (error) {
      reportError(error, context, {
        droppedEvents: 1,
        operation: "create-channel",
      });
      return undefined;
    }
  };

  const postMessage = (message: unknown, context: TransportContext, droppedEvents: number) => {
    const currentChannel = getChannel(context);
    if (!currentChannel) return;
    try {
      // oxlint-disable-next-line require-post-message-target-origin -- BroadcastChannel.postMessage does not accept targetOrigin.
      currentChannel.postMessage(message);
    } catch (error) {
      reportError(error, context, {
        droppedEvents,
        operation: "post-message",
      });
    }
  };

  return {
    name: transportName,
    minLevel: options.minLevel,
    log(event, context) {
      postMessage(mapEvent(event, mapContext), context, 1);
    },
    logBatch(events, context) {
      if (events.length === 0) return;
      postMessage(mapBatch(events, mapContext), context, events.length);
    },
    async close() {
      closed = true;
      if (!channel || !closeChannelOnClose) return;
      try {
        channel.close?.();
      } catch (error) {
        reportError(error, undefined, {
          droppedEvents: 0,
          operation: "close-channel",
        });
      } finally {
        channel = undefined;
      }
    },
  };
}
