import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, getLoggerMetaStats, resetLoggerMetaStats } from "@loggerjs/core";
import { nodeHttpTransport, type NodeHttpTransportOptions } from "../src";

type Fault = "ok" | "server-error" | "rate-limited" | "rate-limited-1s" | "reset" | "hang";

interface Collector {
  url: string;
  acknowledged: Map<string, number>;
  requests: Fault[];
  requestTimes: number[];
  idempotencyKeys: Array<string | undefined>;
  close: () => Promise<void>;
}

const servers: Server[] = [];

// A real HTTP collector whose answer to each request is chosen by `plan`.
// Only events in requests answered with 2xx count as acknowledged.
async function startCollector(plan: (request: number) => Fault): Promise<Collector> {
  const acknowledged = new Map<string, number>();
  const requests: Fault[] = [];
  const requestTimes: number[] = [];
  const idempotencyKeys: Array<string | undefined> = [];
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const fault = plan(requests.length);
    requests.push(fault);
    requestTimes.push(Date.now());
    idempotencyKeys.push(request.headers["idempotency-key"] as string | undefined);
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
      if (fault === "rate-limited-1s") {
        response.writeHead(429, { "retry-after": "1" }).end();
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
    requestTimes,
    idempotencyKeys,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

// Deterministic PRNG so a failing chaos run can be replayed from its seed.
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
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

// Conservation: each emitted event is acknowledged by the collector or
// reported through onDrop, and the collector never sees an unknown event.
function expectConserved(result: RunResult, collector: Collector): void {
  const { emitted } = result;
  const lost = emitted.filter((id) => !collector.acknowledged.has(id) && !result.dropped.has(id));
  expect(lost).toEqual([]);
  expect([...collector.acknowledged.keys()].filter((id) => !emitted.includes(id))).toEqual([]);
}

describe("nodeHttpTransport under injected network faults", () => {
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

  it("delivers every event through transient 5xx and 429 responses", async () => {
    const faults: Fault[] = ["server-error", "rate-limited", "server-error"];
    const collector = await startCollector((request) => faults[request] ?? "ok");

    const result = await emitAndClose(collector, 25);

    expect(result.closeSettled).toBe(true);
    expect(result.dropped.size).toBe(0);
    expect(collector.acknowledged.size).toBe(25);
    expect(getLoggerMetaStats()["transport.retry"]).toBeGreaterThanOrEqual(3);
  });

  it("waits for the collector's Retry-After before retrying", async () => {
    const collector = await startCollector((request) => (request === 0 ? "rate-limited-1s" : "ok"));

    const result = await emitAndClose(collector, 3, { retryMaxDelayMs: 2000 });

    expect(result.closeSettled).toBe(true);
    expect(collector.acknowledged.size).toBe(3);
    expect(collector.requests).toEqual(["rate-limited-1s", "ok"]);
    expect(collector.requestTimes[1]! - collector.requestTimes[0]!).toBeGreaterThanOrEqual(950);
  });

  it("repeats the batch's idempotency key on every retry", async () => {
    const collector = await startCollector((request) => (request < 2 ? "server-error" : "ok"));

    const result = await emitAndClose(collector, 4, { idempotencyKeyHeader: "Idempotency-Key" });

    expect(result.closeSettled).toBe(true);
    expect(collector.requests).toEqual(["server-error", "server-error", "ok"]);
    const [first, ...retries] = collector.idempotencyKeys;
    expect(first).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
    expect(retries).toEqual([first, first]);
  });

  it("sends no idempotency key unless the header is configured", async () => {
    const collector = await startCollector(() => "ok");

    await emitAndClose(collector, 2);

    expect(collector.idempotencyKeys).toEqual([undefined]);
  });

  it("retries after the collector resets the connection", async () => {
    const collector = await startCollector((request) => (request < 2 ? "reset" : "ok"));

    const result = await emitAndClose(collector, 10);

    expect(result.closeSettled).toBe(true);
    expect(collector.acknowledged.size).toBe(10);
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

  it.each([1, 2, 3, 4, 5])(
    "conserves events under random faults (seed %i)",
    async (seed) => {
      const random = mulberry32(seed);
      const faults: Fault[] = ["ok", "ok", "server-error", "rate-limited", "reset", "hang"];
      const collector = await startCollector(
        () => faults[Math.floor(random() * faults.length)] ?? "ok",
      );

      const result = await emitAndClose(collector, 200);

      expect(result.closeSettled).toBe(true);
      expect(result.emitted).toHaveLength(200);
      expectConserved(result, collector);
    },
    20_000,
  );
});
