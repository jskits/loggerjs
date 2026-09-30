import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batchTransport,
  configure,
  createLogger,
  getLogger,
  getLoggerMetaStats,
  resetLoggerMetaStats,
  resetLoggerRegistry,
  retryTransport,
  type DropPolicy,
  type LogEvent,
  type Transport,
} from "../src";

// Model-based lifecycle tests: seeded random sequences of logger operations
// run against transports that fail at random, then assert that no event was
// lost without a trace. Example-based tests missed bugs of this shape (flush
// not waiting for in-flight writes, reconfigure leaking transports, close()
// leaving retries running), so these explore the interleavings instead.

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Random = () => number;

const pick = <T>(random: Random, items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;
const between = (random: Random, min: number, max: number): number =>
  min + Math.floor(random() * (max - min + 1));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A destination that stores whole batches or fails them as a unit: it throws
// synchronously, rejects later, or accepts after a short delay.
function flakySink(random: Random, delivered: Map<string, number>): Transport {
  const store = (events: LogEvent[]) => {
    for (const event of events) delivered.set(event.id, (delivered.get(event.id) ?? 0) + 1);
  };
  const deliver = (events: LogEvent[]): void | Promise<void> => {
    const outcome = pick(random, ["ok", "ok", "slow", "throw", "reject"] as const);
    if (outcome === "ok") return store(events);
    if (outcome === "throw") throw new Error("sink failed");
    const delay = between(random, 0, 3);
    return sleep(delay).then(() => {
      if (outcome === "reject") throw new Error("sink rejected");
      store(events);
    });
  };
  return {
    name: "flaky",
    log: (event) => deliver([event]),
    logBatch: (events) => deliver(events),
  };
}

interface Ledger {
  emitted: string[];
  delivered: Map<string, number>;
  dropped: Map<string, string>;
}

function newLedger(): Ledger {
  return { emitted: [], delivered: new Map(), dropped: new Map() };
}

function captureTransport(ledger: Ledger): Transport {
  return {
    name: "emitted",
    log: (event) => {
      ledger.emitted.push(event.id);
    },
  };
}

function randomBatch(random: Random, ledger: Ledger): Transport {
  return batchTransport(flakySink(random, ledger.delivered), {
    maxBatchSize: between(random, 1, 10),
    maxQueueSize: between(random, 5, 80),
    dropPolicy: pick(random, ["drop-oldest", "drop-newest"] satisfies DropPolicy[]),
    maxRetries: between(random, 0, 3),
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 3,
    concurrency: between(random, 1, 3),
    flushIntervalMs: between(random, 0, 5),
    circuitBreakerFailureThreshold: between(random, 1, 5),
    circuitBreakerResetMs: between(random, 1, 10),
    random,
    onDrop: (event, reason) => {
      ledger.dropped.set(event.id, reason);
    },
  });
}

async function settles(promise: Promise<unknown>, ms = 5_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((done) => {
      timer = setTimeout(() => done(false), ms);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

// Every emitted event was delivered exactly once or reported as dropped,
// never both, and the destination never saw an event that was not emitted.
function expectConserved(ledger: Ledger, seed: number): void {
  const emitted = new Set(ledger.emitted);
  const unaccounted = ledger.emitted.filter(
    (id) => !ledger.delivered.has(id) && !ledger.dropped.has(id),
  );
  const duplicated = [...ledger.delivered].filter(([, count]) => count > 1).map(([id]) => id);
  const deliveredAndDropped = [...ledger.dropped.keys()].filter((id) => ledger.delivered.has(id));
  const unknown = [...ledger.delivered.keys()].filter((id) => !emitted.has(id));
  expect({ seed, unaccounted, duplicated, deliveredAndDropped, unknown }).toEqual({
    seed,
    unaccounted: [],
    duplicated: [],
    deliveredAndDropped: [],
    unknown: [],
  });
}

const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

describe("logger lifecycle model", () => {
  afterEach(async () => {
    await resetLoggerRegistry();
    resetLoggerMetaStats();
    vi.restoreAllMocks();
  });

  it.each(SEEDS)("conserves events through a batched logger (seed %i)", async (seed) => {
    const random = mulberry32(seed);
    const ledger = newLedger();
    const hung: string[] = [];
    const logger = createLogger({
      transports: [randomBatch(random, ledger), captureTransport(ledger)],
      onInternalError: () => {},
    });
    const child = logger.child({ category: ["child"] });

    for (let step = 0; step < 60; step += 1) {
      const operation = pick(random, [
        "log",
        "log",
        "child",
        "burst",
        "flush",
        "flushSync",
        "sleep",
      ] as const);
      if (operation === "log") logger.info("step", { step });
      else if (operation === "child") child.warn("child step", { step });
      else if (operation === "burst") {
        for (let index = 0; index < 20; index += 1) logger.debug("burst", { step, index });
      } else if (operation === "flush") {
        // oxlint-disable-next-line no-await-in-loop -- The model runs operations in order.
        if (!(await settles(logger.flush()))) hung.push(`flush@${step}`);
      } else if (operation === "flushSync") logger.flushSync();
      // oxlint-disable-next-line no-await-in-loop -- The model runs operations in order.
      else await sleep(between(random, 0, 3));
    }

    expect(hung).toEqual([]);
    expect(await settles(logger.close())).toBe(true);
    logger.info("after close");
    expectConserved(ledger, seed);
  });

  it.each(SEEDS)("conserves events across registry reconfiguration (seed %i)", async (seed) => {
    const random = mulberry32(seed);
    const ledger = newLedger();
    const hung: string[] = [];
    const capture = captureTransport(ledger);
    const library = getLogger(["library", "model"]);
    // configure() has no onInternalError, so injected sink failures would be
    // printed through console.error.
    vi.spyOn(console, "error").mockImplementation(() => {});

    for (let step = 0; step < 40; step += 1) {
      const operation = pick(random, ["log", "log", "configure", "flush", "sleep"] as const);
      if (operation === "log") library.info("step", { step });
      else if (operation === "configure") {
        // oxlint-disable-next-line no-await-in-loop -- Reconfiguration must finish before the next step.
        const reconfigured = await settles(
          configure({ level: "debug", transports: [randomBatch(random, ledger), capture] }),
        );
        if (!reconfigured) hung.push(`configure@${step}`);
      } else if (operation === "flush") {
        // oxlint-disable-next-line no-await-in-loop -- The model runs operations in order.
        if (!(await settles(library.flush()))) hung.push(`flush@${step}`);
      }
      // oxlint-disable-next-line no-await-in-loop -- The model runs operations in order.
      else await sleep(between(random, 0, 3));
    }

    expect(hung).toEqual([]);
    expect(await settles(resetLoggerRegistry())).toBe(true);
    expectConserved(ledger, seed);
  });

  it.each(SEEDS)("counts every event retryTransport gives up on (seed %i)", async (seed) => {
    const random = mulberry32(seed);
    const ledger = newLedger();
    const hung: string[] = [];
    const logger = createLogger({
      transports: [
        retryTransport(flakySink(random, ledger.delivered), {
          maxRetries: between(random, 0, 3),
          retryBaseDelayMs: 1,
          retryMaxDelayMs: 2,
          // Keep the breaker closed so each event gets its full retry budget.
          circuitBreakerFailureThreshold: Number.POSITIVE_INFINITY,
          random,
        }),
        captureTransport(ledger),
      ],
      onInternalError: () => {},
    });

    for (let step = 0; step < 40; step += 1) {
      logger.info("step", { step });
      // oxlint-disable-next-line no-await-in-loop -- The model runs operations in order.
      if (random() < 0.2 && !(await settles(logger.flush()))) hung.push(`flush@${step}`);
    }
    expect(hung).toEqual([]);
    expect(await settles(logger.close())).toBe(true);

    // retryTransport has no drop callback: each event it gives up on is one
    // transport.retry.exhausted count, and together with deliveries they
    // must cover every emitted event exactly once.
    const exhausted = getLoggerMetaStats()["transport.retry.exhausted"] ?? 0;
    expect(ledger.delivered.size + exhausted).toBe(ledger.emitted.length);
    expect([...ledger.delivered.values()].every((count) => count === 1)).toBe(true);
  });

  it.each(SEEDS)(
    "settles every in-flight write before close() resolves (seed %i)",
    async (seed) => {
      const random = mulberry32(seed);
      const ledger = newLedger();
      const hung: string[] = [];
      // A raw async transport: only the logger itself can wait for its writes.
      const logger = createLogger({
        transports: [flakySink(random, ledger.delivered), captureTransport(ledger)],
        onInternalError: () => {},
      });
      const child = logger.child({ category: ["child"] });

      for (let step = 0; step < 40; step += 1) {
        if (random() < 0.5) logger.info("step", { step });
        else child.info("child step", { step });
        // oxlint-disable-next-line no-await-in-loop -- The model runs operations in order.
        if (random() < 0.1 && !(await settles(logger.flush()))) hung.push(`flush@${step}`);
      }
      expect(hung).toEqual([]);
      expect(await settles(logger.close())).toBe(true);

      // Each write either stored its event or failed and was counted, and all of
      // them had finished by the time close() resolved.
      const failed = getLoggerMetaStats()["transport.errors"] ?? 0;
      expect(ledger.delivered.size + failed).toBe(ledger.emitted.length);
    },
  );
});
