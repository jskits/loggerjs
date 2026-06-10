import { createSocket } from "dgram";
import { createConnection } from "net";
import { hostname as getHostname } from "os";
import {
  safeJsonStringify,
  type LogEvent,
  type LoggerLevel,
  type Transport,
  type TransportContext,
} from "@loggerjs/core";

export type NodeSyslogProtocol = "tcp" | "udp4" | "udp6";
export type NodeSyslogTcpFraming = "newline" | "octet-counting";

export interface NodeSyslogUdpSocket {
  send: (
    message: string | Uint8Array,
    port: number,
    host: string,
    callback?: (error: Error | null | undefined) => void,
  ) => void;
  close?: () => void;
  on?: (event: "error", listener: (error: Error) => void) => void;
  unref?: () => void;
}

export interface NodeSyslogTcpSocket {
  write: (message: string | Uint8Array, callback?: (error?: Error | null) => void) => boolean;
  end?: () => void;
  destroy?: () => void;
  on?: (event: "error", listener: (error: Error) => void) => void;
  unref?: () => void;
}

export type NodeSyslogUdpSocketFactory = (protocol: "udp4" | "udp6") => NodeSyslogUdpSocket;
export type NodeSyslogTcpSocketFactory = (options: {
  host: string;
  port: number;
}) => NodeSyslogTcpSocket;

export interface NodeSyslogFormatOptions {
  facility?: number;
  hostname?: string;
  appName?: string | ((event: LogEvent) => string);
  procId?: string | number | ((event: LogEvent) => string | number);
  msgId?: string | ((event: LogEvent) => string);
  structuredData?: string | ((event: LogEvent) => string);
  formatMessage?: (event: LogEvent) => string;
}

export interface NodeSyslogTransportOptions extends NodeSyslogFormatOptions {
  name?: string;
  minLevel?: LoggerLevel;
  protocol?: NodeSyslogProtocol;
  host?: string;
  port?: number;
  tcpFraming?: NodeSyslogTcpFraming;
  unref?: boolean;
  udpSocketFactory?: NodeSyslogUdpSocketFactory;
  tcpSocketFactory?: NodeSyslogTcpSocketFactory;
  onError?: (error: unknown, detail: { operation: string }) => void;
}

const severityByLevel: Record<string, number> = {
  trace: 7,
  debug: 7,
  info: 6,
  warn: 4,
  error: 3,
  fatal: 2,
};

function defaultUdpSocketFactory(protocol: "udp4" | "udp6") {
  return createSocket(protocol);
}

function defaultTcpSocketFactory(options: { host: string; port: number }) {
  return createConnection(options);
}

function headerValue(value: unknown, fallback: string, maxLength: number) {
  const text = String(value ?? fallback)
    .trim()
    .replace(/\s+/g, "_");
  if (!text) return fallback;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function timestamp(time: number) {
  const value = new Date(time).toISOString();
  return value === "Invalid Date" ? "-" : value;
}

function valueFor<T>(
  value: T | ((event: LogEvent) => T) | undefined,
  event: LogEvent,
  fallback: T,
) {
  return typeof value === "function"
    ? (value as (event: LogEvent) => T)(event)
    : (value ?? fallback);
}

function defaultMessage(event: LogEvent) {
  const extra: Record<string, unknown> = {};
  if (event.data !== undefined) extra.data = event.data;
  if (event.context !== undefined) extra.context = event.context;
  if (event.error !== undefined) extra.error = event.error;
  if (Object.keys(extra).length === 0) return event.message;
  return `${event.message} ${safeJsonStringify(extra)}`;
}

export function formatSyslogMessage(
  event: LogEvent,
  options: NodeSyslogFormatOptions = {},
): string {
  const facility = Math.max(0, Math.min(23, Math.trunc(options.facility ?? 1)));
  const severity = severityByLevel[event.levelName] ?? 6;
  const priority = facility * 8 + severity;
  const host = headerValue(options.hostname, getHostname(), 255);
  const appName = headerValue(valueFor(options.appName, event, event.logger), "-", 48);
  const procId = headerValue(valueFor(options.procId, event, "-"), "-", 128);
  const msgId = headerValue(valueFor(options.msgId, event, event.type ?? event.levelName), "-", 32);
  const structuredData = valueFor(options.structuredData, event, "-") || "-";
  const message = options.formatMessage ? options.formatMessage(event) : defaultMessage(event);

  return `<${priority}>1 ${timestamp(event.time)} ${host} ${appName} ${procId} ${msgId} ${structuredData} ${message}`;
}

export function nodeSyslogTransport(options: NodeSyslogTransportOptions = {}): Transport {
  const protocol = options.protocol ?? "udp4";
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 514;
  const transportName = options.name ?? "syslog";
  const unref = options.unref ?? true;
  const tcpFraming = options.tcpFraming ?? "newline";
  const udpSocketFactory = options.udpSocketFactory ?? defaultUdpSocketFactory;
  const tcpSocketFactory = options.tcpSocketFactory ?? defaultTcpSocketFactory;
  let udpSocket: NodeSyslogUdpSocket | undefined;
  let tcpSocket: NodeSyslogTcpSocket | undefined;
  let lastContext: TransportContext | undefined;

  const reportError = (
    error: unknown,
    context: TransportContext | undefined,
    operation: string,
  ) => {
    try {
      options.onError?.(error, { operation });
    } catch (onErrorError) {
      context?.reportInternalError(onErrorError, {
        operation: "on-error",
        phase: "transport",
        transport: transportName,
      });
    }

    context?.reportInternalError(error, {
      operation,
      phase: "transport",
      transport: transportName,
    });
  };

  const getUdpSocket = (context: TransportContext) => {
    if (udpSocket) return udpSocket;
    const socket = udpSocketFactory(protocol === "udp6" ? "udp6" : "udp4");
    socket.on?.("error", (error) => reportError(error, lastContext ?? context, "socket-error"));
    if (unref) socket.unref?.();
    udpSocket = socket;
    return socket;
  };

  const getTcpSocket = (context: TransportContext) => {
    if (tcpSocket) return tcpSocket;
    const socket = tcpSocketFactory({ host, port });
    socket.on?.("error", (error) => reportError(error, lastContext ?? context, "socket-error"));
    if (unref) socket.unref?.();
    tcpSocket = socket;
    return socket;
  };

  const send = (message: string, context: TransportContext) => {
    lastContext = context;
    if (protocol === "tcp") {
      const bytes = new TextEncoder().encode(message).byteLength;
      const payload = tcpFraming === "octet-counting" ? `${bytes} ${message}` : `${message}\n`;
      const socket = getTcpSocket(context);
      socket.write(payload, (error) => {
        if (error) reportError(error, context, "send");
      });
      return;
    }

    const socket = getUdpSocket(context);
    socket.send(message, port, host, (error) => {
      if (error) reportError(error, context, "send");
    });
  };

  return {
    name: transportName,
    minLevel: options.minLevel,
    log(event, context) {
      send(formatSyslogMessage(event, options), context);
    },
    logBatch(events, context) {
      for (const event of events) send(formatSyslogMessage(event, options), context);
    },
    async close() {
      udpSocket?.close?.();
      udpSocket = undefined;
      tcpSocket?.end?.();
      tcpSocket = undefined;
    },
  };
}
