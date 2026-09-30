import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, getLoggerMetaStats, resetLoggerMetaStats } from "@loggerjs/core";
import { nodeHttpTransport, type NodeHttpTransportOptions } from "../src";

type Fault = "ok" | "server-error" | "rate-limited" | "reset" | "hang";

interface Collector {
  url: string;
  acknowledged: Map<string, number>;
  requests: Fault[];
  close: () => Promise<void>;
}

const servers: Server[] = [];

// A real HTTP collector whose answer to each request is chosen by `plan`.
// Only events in requests answered with 2xx count as acknowledged.
async function startCollector(plan: (request: number) => Fault): Promise<Collector> {
  const acknowledged = new Map<string, number>();
  const requests: Fault[] = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const fault = plan(requests.length);
    requests.push(fault);
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (fault === "hang") return;
      if (fault === "reset") {
        request.socket.destroy();
        return;
      }
      if (fault === "server-error") {
        response.writeHead(503).end();
        return;
      }
      if (fault === "rate-limited") {
        response.writeHead(429, { "retry-after": "0" }).end();
        return;
      }
      const events = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Array<{ id: string }>;
      for (const event of events) {
        acknowledged.set(event.id, (acknowledged.get(event.id) ?? 0) + 1);
      }
      response.writeHead(204).end();
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/logs`,
    acknowledged,
    requests,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

interface RunResult {
  emitted: string[];
  dropped: Map<string, string>;
  closeSettled: boolean;
}

async function emitAndClose(
  collector: Collector,
  count: number,
  options: Partial<NodeHttpTransportOptions> = {},
  closeBudgetMs = 10_000,
): Promise<RunResult> {
  const emitted: string[] = [];
  const dropped = new Map<string, string>();
  const logger = createLogger({
    transports: [
      nodeHttpTransport({
        url: collector.url,
        maxBatchSize: 10,
        flushIntervalMs: 5,
        maxRetries: 3,
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 5,
        timeoutMs: 200,
        onDrop: (event, reason) => dropped.set(event.id, reason),
        ...options,
      }),
      // Sees the same event ids the HTTP transport sends.
      {
        name: "emitted",
        log: (event) => {
          emitted.push(event.id);
        },
      },
    ],
    // The transport reports every failed attempt; the invariant below is what
    // this suite checks, so keep the console quiet.
    onInternalError: () => {},
  });
  for (let index = 0; index < count; index += 1) logger.info("probe", { index });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const closeSettled = await Promise.race([
    logger.close().then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(false), closeBudgetMs);
    }),
  ]);
  clearTimeout(timer);
  return { emitted, dropped, closeSettled };
}

describe("nodeHttpTransport request timeout", () => {
  afterEach(async () => {
    resetLoggerMetaStats();
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      ),
    );
  });

  it("times out a collector that never answers instead of hanging close()", async () => {
    const collector = await startCollector(() => "hang");

    const started = Date.now();
    const result = await emitAndClose(collector, 5, { maxRetries: 1 }, 5_000);

    expect(result.closeSettled).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(collector.acknowledged.size).toBe(0);
    expect(result.dropped.size).toBe(5);
    expect(getLoggerMetaStats()["transport.dropped.closed"]).toBe(5);
  });
});
