import { describe, expect, it, vi } from "vitest";
import { type LogEvent, type TransportContext } from "@loggerjs/core";
import {
  formatSyslogMessage,
  nodeSyslogTransport,
  type NodeSyslogTcpSocket,
  type NodeSyslogUdpSocket,
} from "../src";

const event: LogEvent = {
  id: "evt-1",
  time: 0,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "api",
  type: "order.created",
  message: "created",
  data: { orderId: "ord-1" },
};

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "api",
    now: () => 1,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

describe("nodeSyslogTransport", () => {
  it("formats RFC5424-style messages with syslog priority", () => {
    const message = formatSyslogMessage(
      { ...event, levelName: "warn", level: 40 },
      {
        appName: "checkout api",
        facility: 16,
        hostname: "node one",
        procId: "worker 1",
        structuredData: '[loggerjs event_id="evt-1"]',
      },
    );

    expect(message).toBe(
      '<132>1 1970-01-01T00:00:00.000Z node_one checkout_api worker_1 order.created [loggerjs event_id="evt-1"] created {"data":{"orderId":"ord-1"}}',
    );
  });

  it("sends UDP messages to the configured host and port", () => {
    const sends: Array<{ host: string; message: string | Uint8Array; port: number }> = [];
    const close = vi.fn<() => void>();
    const unref = vi.fn<() => void>();
    const socket: NodeSyslogUdpSocket = {
      close,
      send(message, port, host, callback) {
        sends.push({ host, message, port });
        callback?.(undefined);
      },
      unref,
    };
    const transport = nodeSyslogTransport({
      facility: 16,
      host: "syslog.local",
      hostname: "node",
      port: 5514,
      udpSocketFactory(protocol) {
        expect(protocol).toBe("udp4");
        return socket;
      },
    });

    transport.log?.({ ...event, levelName: "error", level: 50 }, createContext());
    transport.close?.();

    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ host: "syslog.local", port: 5514 });
    expect(String(sends[0]?.message)).toContain("<131>1 1970-01-01T00:00:00.000Z node api");
    expect(unref).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("writes TCP messages with octet-counting framing", async () => {
    const writes: string[] = [];
    const end = vi.fn<() => void>();
    const socket: NodeSyslogTcpSocket = {
      end,
      write(message, callback) {
        writes.push(String(message));
        callback?.(undefined);
        return true;
      },
    };
    const transport = nodeSyslogTransport({
      hostname: "node",
      protocol: "tcp",
      tcpFraming: "octet-counting",
      tcpSocketFactory(options) {
        expect(options).toEqual({ host: "127.0.0.1", port: 514 });
        return socket;
      },
    });

    transport.log?.(event, createContext());
    await transport.close?.();

    const [size, ...rest] = writes[0]?.split(" ") ?? [];
    const payload = rest.join(" ");
    expect(Number(size)).toBe(new TextEncoder().encode(payload).byteLength);
    expect(payload).toContain("<14>1 1970-01-01T00:00:00.000Z node api");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("reports send callback failures", () => {
    const errors: unknown[] = [];
    const onError = vi.fn<(error: unknown, detail: { operation: string }) => void>();
    const transport = nodeSyslogTransport({
      onError,
      udpSocketFactory() {
        return {
          send(_message, _port, _host, callback) {
            callback?.(new Error("down"));
          },
        };
      },
    });

    transport.log?.(event, createContext(errors));

    expect(errors).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { operation: "send" });
  });
});
