import { afterEach, describe, expect, it, vi } from "vitest";
import {
  batchTransport,
  createRecord,
  estimateLogEventBytes,
  estimateLogRecordBytes,
  getLoggerMetaGauges,
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  type LogEvent,
  type LogRecord,
  type Transport,
  type TransportContext,
} from "../src";

// ---------------------------------------------------------------------------
// Shared fixtures / helpers (mirrors batch-transport.test.ts conventions).
// ---------------------------------------------------------------------------

const event: LogEvent = {
  id: "evt-1",
  time: 1,
  seq: 1,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "created",
};

function createContext(errors: unknown[] = []): TransportContext {
  return {
    loggerName: "test",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error) {
      errors.push(error);
    },
  };
}

function createRecordContext(
  toEvent: TransportContext["toEvent"] = recordToEvent,
): TransportContext {
  return {
    loggerName: "test",
    now: () => 1,
    toEvent,
    reportInternalError() {},
  };
}

interface ReportedError {
  error: unknown;
  detail: Record<string, unknown> | undefined;
}

// Drains the microtask queue enough times for a deeply-chained floating promise
// (flush -> flushLoop -> Promise.allSettled -> reject -> catch) to settle. Used
// only with real timers; deterministic because it awaits a fixed count.
async function flushMicrotasks(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) {
    // oxlint-disable-next-line no-await-in-loop -- Sequential microtask drains.
    await Promise.resolve();
  }
}

// Captures the full (error, detail) tuple passed to reportInternalError so we
// can assert the EXACT detail object — phase/transport/operation string
// literals and the surrounding object literal all have surviving mutants.
function createReportingContext(reported: ReportedError[]): TransportContext {
  return {
    loggerName: "test",
    now: () => 1,
    toEvent: recordToEvent,
    reportInternalError(error, detail) {
      reported.push({ error, detail });
    },
  };
}

// estimateLogEventBytes/estimateLogRecordBytes both start at the object branch
// (depth 0). To probe the value-typed branches we embed a single-character key
// holding the value under test. The object branch contributes a fixed prefix:
//   2 (object base) + utf8("x")=1 + 3 (key overhead) = 6
// so estimateLogEventBytes({ x: value }) === 6 + estimateValueBytes(value@depth1).
const OBJECT_PREFIX_ONE_ASCII_KEY = 6;

function bytesOf(value: unknown): number {
  // Cast through unknown: the estimators walk arbitrary structures; the public
  // LogEvent/LogRecord typing is only a surface constraint.
  return estimateLogEventBytes({ x: value } as unknown as LogEvent) - OBJECT_PREFIX_ONE_ASCII_KEY;
}

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// estimateUtf8ByteLength — UTF-8 width boundaries (0x80 / 0x800 / 0xd800..0xdbff)
// ===========================================================================

describe("estimateUtf8ByteLength widths (via estimateLogEventBytes)", () => {
  it("counts 1-byte ASCII (code < 0x80) as +1 each", () => {
    // "hello" => 5 ascii chars => 5 utf8 bytes; string adds +2 => 7.
    expect(bytesOf("hello")).toBe(5 + 2);
  });

  it("counts 2-byte chars (0x80 <= code < 0x800) as +2 each", () => {
    // "é" U+00E9 and "ñ" U+00F1 are both in [0x80, 0x800).
    expect(bytesOf("é")).toBe(2 + 2);
    expect(bytesOf("ñ")).toBe(2 + 2);
    // Two of them => 4 utf8 bytes.
    expect(bytesOf("éñ")).toBe(4 + 2);
  });

  it("counts 3-byte chars (code >= 0x800, non-surrogate) as +3 each", () => {
    // "中" U+4E2D and "€" U+20AC are >= 0x800 and not surrogates.
    expect(bytesOf("中")).toBe(3 + 2);
    expect(bytesOf("€")).toBe(3 + 2);
    expect(bytesOf("中€")).toBe(6 + 2);
  });

  it("counts a high-surrogate pair (0xd800..0xdbff) as +4 and skips the trailing unit", () => {
    // "😀" U+1F600 is a surrogate pair: charCodeAt(0)=0xd83d (high surrogate),
    // length === 2. The branch adds 4 and advances index past the low surrogate,
    // so the total is 4 (not 4+something for the low unit, and not 3+3).
    expect(bytesOf("😀")).toBe(4 + 2);
  });

  it("pins the high-surrogate range endpoints 0xd800 and 0xdbff (inclusive on both ends)", () => {
    // A lone high surrogate at the LOW end (0xd800): followed by a non-low-
    // surrogate unit, the branch still adds 4 and skips the next index. Here the
    // next unit is "A" (ascii), which the skip swallows, so total is exactly 4.
    // If the lower bound were `code > 0xd800` this char would fall to the 3-byte
    // else branch (3) + "A" (1) = 4 as well, so disambiguate via the skip: use a
    // FULL pair whose high unit is exactly 0xd800.
    expect(bytesOf("𐀀")).toBe(4 + 2); // U+10000, high unit == 0xd800
    // A pair whose high unit is exactly 0xdbff (the TOP of the range): U+10FFFF.
    // `code <= 0xdbff` must include it (+4, skip low unit). The `< 0xdbff` mutant
    // would treat 0xdbff as a 3-byte char and then count the trailing low
    // surrogate separately => 3 + 3 = 6, not 4.
    expect(bytesOf("􏿿")).toBe(4 + 2); // U+10FFFF, high unit == 0xdbff
  });

  it("sums mixed widths exactly so each boundary constant is pinned", () => {
    // "Aé中😀" = 1 (ascii) + 2 (2-byte) + 3 (3-byte) + 4 (surrogate) = 10 utf8 bytes.
    expect(bytesOf("Aé中😀")).toBe(10 + 2);
    // Trailing ASCII after the surrogate proves the index skip lands correctly:
    // "😀A" = 4 + 1 = 5; if the skip were wrong the low surrogate or the "A"
    // would be miscounted.
    expect(bytesOf("😀A")).toBe(5 + 2);
  });
});

// ===========================================================================
// estimateValueBytes — typeof branches with exact returns
// ===========================================================================

describe("estimateValueBytes typeof branches (via estimateLogEventBytes)", () => {
  it("null => 4", () => {
    expect(bytesOf(null)).toBe(4);
  });

  it("string => utf8 + 2", () => {
    expect(bytesOf("")).toBe(0 + 2);
    expect(bytesOf("ab")).toBe(2 + 2);
  });

  it("finite number => 8, non-finite number => 4", () => {
    expect(bytesOf(0)).toBe(8);
    expect(bytesOf(3.5)).toBe(8);
    expect(bytesOf(-1)).toBe(8);
    expect(bytesOf(Number.POSITIVE_INFINITY)).toBe(4);
    expect(bytesOf(Number.NEGATIVE_INFINITY)).toBe(4);
    expect(bytesOf(Number.NaN)).toBe(4);
  });

  it("boolean true => 4, false => 5", () => {
    expect(bytesOf(true)).toBe(4);
    expect(bytesOf(false)).toBe(5);
  });

  it("bigint => toString().length + 2", () => {
    expect(bytesOf(123n)).toBe(3 + 2); // "123" -> 3
    expect(bytesOf(-9007199254740993n)).toBe(17 + 2); // 17-char string
    expect(bytesOf(0n)).toBe(1 + 2); // "0" -> 1
  });

  it("undefined / function / symbol => 0", () => {
    expect(bytesOf(undefined)).toBe(0);
    expect(bytesOf(() => "ignored")).toBe(0);
    expect(bytesOf(Symbol("s"))).toBe(0);
  });
});

// ===========================================================================
// estimateValueBytes — object / array / circular / depth / overflow
// ===========================================================================

describe("estimateValueBytes structural branches", () => {
  it("object => 2 + sum(keyUtf8 + 3 + valueBytes)", () => {
    // { a: "hi" } => 2 + (1 + 3 + (2 + 2)) = 2 + 8 = 10.
    expect(estimateLogEventBytes({ a: "hi" } as unknown as LogEvent)).toBe(10);
    // Mixed primitive object pins every typeof return simultaneously: total 78.
    const mixed = {
      n: null, // key 1 + 3 + 4
      s: "A", // key 1 + 3 + 3
      num: 3.5, // key 3 + 3 + 8
      inf: Number.POSITIVE_INFINITY, // key 3 + 3 + 4
      t: true, // key 1 + 3 + 4
      f: false, // key 1 + 3 + 5
      big: 123n, // key 3 + 3 + 5
      u: undefined, // key 1 + 3 + 0
      fn: () => "x", // key 2 + 3 + 0
    };
    expect(estimateLogEventBytes(mixed as unknown as LogEvent)).toBe(78);
  });

  it("array => 2 + sum(item + 1) with no overflow when within MAX_ESTIMATE_KEYS", () => {
    // [1,2,3] at depth 1 => 2 + (8+1)*3 = 29.
    expect(bytesOf([1, 2, 3])).toBe(29);
    // empty array => just the base 2.
    expect(bytesOf([])).toBe(2);
  });

  it("circular reference => 16 for the repeated node", () => {
    const c: Record<string, unknown> = {};
    c.self = c;
    // top object adds c to `seen` before iterating, so c.self hits seen => 16.
    // total = 2 + (utf8("self")=4 + 3 + 16) = 25.
    expect(estimateLogEventBytes(c as unknown as LogEvent)).toBe(25);
  });

  it("a shared sibling reference is counted once, then 16 thereafter", () => {
    const shared = { v: 1 };
    // p: fresh object => 2 + (1 + 3 + 8) = 14; entry = 1 + 3 + 14 = 18.
    // q: shared now in seen => 16; entry = 1 + 3 + 16 = 20.
    // total = 2 + 18 + 20 = 40.
    expect(estimateLogEventBytes({ p: shared, q: shared } as unknown as LogEvent)).toBe(40);
  });

  it("depth >= MAX_ESTIMATE_DEPTH (4) collapses the node to 32 regardless of contents", () => {
    // top(0).a(1).b(2).c(3 still recurses).d(4 => 32). The value of `d` is
    // ignored once depth hits 4, so all three shapes produce the same total.
    expect(estimateLogEventBytes({ a: { b: { c: { d: { e: 1 } } } } } as unknown as LogEvent)).toBe(
      56,
    );
    expect(
      estimateLogEventBytes({
        a: { b: { c: { d: { e: "a very long string here" } } } },
      } as unknown as LogEvent),
    ).toBe(56);
    expect(estimateLogEventBytes({ a: { b: { c: { d: {} } } } } as unknown as LogEvent)).toBe(56);
  });

  it("array overflow past MAX_ESTIMATE_KEYS (64) adds exactly 8 per extra item", () => {
    const arr = (n: number) => ({ a: Array.from({ length: n }, () => null) });
    const at = (n: number) => estimateLogEventBytes(arr(n) as unknown as LogEvent);
    // 64 nulls: a-array = 2 + (4+1)*64 = 322; no overflow.
    // entry = utf8("a")=1 + 3 + 322 = 326; total = 2 + 326 = 328.
    expect(at(64)).toBe(328);
    // Each item beyond 64 adds exactly 8 (the Math.max(0, len-limit)*8 term).
    expect(at(65) - at(64)).toBe(8);
    expect(at(66) - at(65)).toBe(8);
  });

  it("object key overflow past MAX_ESTIMATE_KEYS (64) adds a flat 64 then breaks", () => {
    const obj = (n: number) => {
      const o: Record<string, unknown> = {};
      for (let i = 0; i < n; i++) o[`x${i}`] = null;
      return o;
    };
    const at = (n: number) => estimateLogEventBytes(obj(n) as unknown as LogEvent);
    // Going from 64 -> 65 keys: the 65th iteration sees count >= 64, adds a flat
    // 64 and breaks. So the delta is exactly 64.
    expect(at(65) - at(64)).toBe(64);
    // 66 keys produces the SAME total as 65 because the loop breaks early.
    expect(at(66)).toBe(at(65));
  });
});

// ===========================================================================
// estimateLogRecordBytes — exercises the second exported entry point
// ===========================================================================

describe("estimateLogRecordBytes", () => {
  it("walks the record object identically to estimateLogEventBytes", () => {
    const payload = { a: "hi" };
    expect(estimateLogRecordBytes(payload as unknown as LogRecord)).toBe(10);
    expect(estimateLogRecordBytes(payload as unknown as LogRecord)).toBe(
      estimateLogEventBytes(payload as unknown as LogEvent),
    );
  });
});

// ===========================================================================
// maxBytes flush split boundary (takeBatch) + default-infinite skip
// ===========================================================================

describe("maxBytes budget in takeBatch", () => {
  it("breaks a batch exactly when bytes + next > maxBytes (strict >, never on the first item)", async () => {
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((item) => item.id));
        },
      },
      {
        maxBatchSize: 10,
        maxBytes: 6,
        flushIntervalMs: 0,
        estimateEventBytes() {
          return 3;
        },
      },
    );

    const context = createContext();
    // Three 3-byte items, budget 6: first batch takes 3 (always takes 1st),
    // then 3+3=6 which is NOT > 6 so the 2nd joins; the 3rd would make 9 > 6 so
    // it breaks into a new batch. => [[1,2],[3]].
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context);
    await transport.flush?.();

    expect(batches).toEqual([["evt-1", "evt-2"], ["evt-3"]]);
  });

  it("still puts an oversized-but-not-dropped item alone because batch.length>0 guard skips the first", async () => {
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((item) => item.id));
        },
      },
      {
        maxBatchSize: 10,
        maxBytes: 10,
        flushIntervalMs: 0,
        estimateEventBytes(item) {
          // evt-2 is exactly at the budget; combined with evt-1 (4) it would be
          // 14 > 10, so evt-2 starts its own batch. But as the FIRST element of
          // that batch the guard (batch.length > 0) lets it through alone.
          return item.seq === 2 ? 10 : 4;
        },
      },
    );

    const context = createContext();
    transport.log?.(event, context); // 4
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // 10
    await transport.flush?.();

    expect(batches).toEqual([["evt-1"], ["evt-2"]]);
  });

  it("skips byte estimation entirely when maxBytes is the default (infinite)", () => {
    const estimate = vi.fn<(event: LogEvent) => number>(() => 1);
    const transport = batchTransport(
      { name: "inner", logBatch() {} },
      { maxBatchSize: 10, flushIntervalMs: 0, estimateEventBytes: estimate },
    );
    transport.log?.(event, createContext());
    expect(estimate).not.toHaveBeenCalled();
  });

  it("runs byte estimation exactly once per record when a finite maxBytes is set", () => {
    const estimate = vi.fn<(event: LogEvent) => number>(() => 1);
    const transport = batchTransport(
      { name: "inner", logBatch() {} },
      { maxBatchSize: 10, maxBytes: 100, flushIntervalMs: 0, estimateEventBytes: estimate },
    );
    transport.log?.(event, createContext());
    expect(estimate).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// dropPolicy overflow behavior — which items survive + dropped counters
// ===========================================================================

describe("dropPolicy at maxQueueSize overflow", () => {
  it("drop-newest keeps the existing queue and drops the incoming item", async () => {
    resetLoggerMetaStats();
    const dropped: string[] = [];
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((item) => item.id));
        },
      },
      {
        maxBatchSize: 10,
        maxQueueSize: 2,
        flushIntervalMs: 0,
        dropPolicy: "drop-newest",
        onDrop(droppedEvent) {
          dropped.push(droppedEvent.id);
        },
      },
    );

    const context = createContext();
    transport.log?.(event, context); // evt-1
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // evt-2 (queue full now)
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context); // dropped (newest)
    await transport.flush?.();

    expect(dropped).toEqual(["evt-3"]);
    expect(batches).toEqual([["evt-1", "evt-2"]]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("drop-oldest evicts the head and keeps the newest item", async () => {
    resetLoggerMetaStats();
    const dropped: string[] = [];
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((item) => item.id));
        },
      },
      {
        maxBatchSize: 10,
        maxQueueSize: 2,
        flushIntervalMs: 0,
        dropPolicy: "drop-oldest",
        onDrop(droppedEvent) {
          dropped.push(droppedEvent.id);
        },
      },
    );

    const context = createContext();
    transport.log?.(event, context); // evt-1
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // evt-2 (full)
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context); // evicts evt-1, keeps evt-2, evt-3
    await transport.flush?.();

    expect(dropped).toEqual(["evt-1"]);
    expect(batches).toEqual([["evt-2", "evt-3"]]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("throw policy drops the incoming item, reports an internal error, and keeps the queue", async () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const dropped: string[] = [];
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((item) => item.id));
        },
      },
      {
        maxBatchSize: 10,
        maxQueueSize: 2,
        flushIntervalMs: 0,
        dropPolicy: "throw",
        onDrop(droppedEvent) {
          dropped.push(droppedEvent.id);
        },
      },
    );

    const context = createContext(errors);
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context); // dropped (incoming)
    await transport.flush?.();

    expect(dropped).toEqual(["evt-3"]);
    expect(batches).toEqual([["evt-1", "evt-2"]]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain("dropped log: queue-full");
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.queue-full": 1,
    });
  });

  it("record-too-large drops before the queue check and tags the reason", async () => {
    resetLoggerMetaStats();
    const dropped: string[] = [];
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>();
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        maxBytes: 4,
        flushIntervalMs: 0,
        estimateEventBytes() {
          return 5; // 5 > 4 => record-too-large
        },
        onDrop(droppedEvent) {
          dropped.push(droppedEvent.id);
        },
      },
    );

    transport.log?.(event, createContext());
    await transport.flush?.();

    expect(dropped).toEqual(["evt-1"]);
    expect(logBatch).not.toHaveBeenCalled();
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.dropped": 1,
      "transport.dropped.record-too-large": 1,
    });
  });
});

// ===========================================================================
// enqueue flush trigger boundary (queue.length >= maxBatchSize)
// ===========================================================================

describe("enqueue immediate-flush boundary", () => {
  it("does not auto-flush below maxBatchSize but flushes on reaching it", async () => {
    const calls: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          calls.push(events.map((item) => item.id));
        },
      },
      {
        maxBatchSize: 2,
        // Large interval so a timer-based flush cannot interfere; only the
        // size-trigger should fire a flush.
        flushIntervalMs: 1_000_000,
      },
    );

    const context = createContext();
    transport.log?.(event, context); // queue length 1 (< 2) -> schedule only
    await Promise.resolve();
    expect(calls).toEqual([]); // no flush yet

    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // length 2 (>= 2) -> flush
    await transport.flush?.();
    expect(calls).toEqual([["evt-1", "evt-2"]]);
  });
});

// ===========================================================================
// minLevel filtering (enqueueRecord / enqueueEvent)
// ===========================================================================

describe("inner.minLevel gating", () => {
  it("drops events strictly below inner.minLevel and keeps events at or above it", async () => {
    const seen: string[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        minLevel: "warn", // value 40
        logBatch(events) {
          for (const e of events) seen.push(e.id);
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createContext();
    transport.log?.({ ...event, id: "below", seq: 1, level: 39 }, context); // 39 < 40 dropped
    transport.log?.({ ...event, id: "equal", seq: 2, level: 40 }, context); // 40 == 40 kept
    transport.log?.({ ...event, id: "above", seq: 3, level: 41 }, context); // 41 > 40 kept
    await transport.flush?.();

    expect(seen).toEqual(["equal", "above"]);
  });

  it("keeps a below-info event when inner has no minLevel (undefined guard)", async () => {
    const seen: string[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        // No minLevel: the gate must be skipped entirely. The `true &&` mutant
        // would compare against toLevelValue(undefined)===30 and drop level-10.
        logBatch(events) {
          for (const e of events) seen.push(e.id);
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    transport.log?.({ ...event, id: "trace", seq: 1, level: 10 }, createContext());
    await transport.flush?.();

    expect(seen).toEqual(["trace"]);
  });

  it("keeps a below-info record when inner has no minLevel (undefined guard)", async () => {
    const seen: number[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        writeBatch(records) {
          for (const r of records) seen.push(r.seq);
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    transport.write?.(
      createRecord({ time: 1, level: 10, msg: "lo", seq: 7 }),
      createRecordContext(),
    );
    await transport.flush?.();

    expect(seen).toEqual([7]);
  });

  it("drops records strictly below inner.minLevel", async () => {
    const seen: number[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        minLevel: "error", // value 50
        writeBatch(records) {
          for (const r of records) seen.push(r.seq);
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createRecordContext();
    transport.write?.(createRecord({ time: 1, level: 49, msg: "lo", seq: 1 }), context); // dropped
    transport.write?.(createRecord({ time: 1, level: 50, msg: "ok", seq: 2 }), context); // kept
    await transport.flush?.();

    expect(seen).toEqual([2]);
  });
});

// ===========================================================================
// stats() shape — flushes / lastFlushBatchSize / maxQueueDepth / queueDepth
// ===========================================================================

describe("stats() reporting", () => {
  it("reports flushes, lastFlushBatchSize, maxQueueDepth and drains queueDepth", async () => {
    const transport = batchTransport(
      { name: "inner", logBatch() {} },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createContext();
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context);

    // Before flushing, the queue holds 3 and the high-water mark is 3.
    expect(transport.stats().queueDepth).toBe(3);
    expect(transport.stats().maxQueueDepth).toBe(3);

    await transport.flush?.();

    const stats = transport.stats();
    expect(stats.flushes).toBe(1);
    expect(stats.flushErrors).toBe(0);
    expect(stats.lastFlushBatchSize).toBe(3);
    expect(stats.maxQueueDepth).toBe(3); // high-water mark persists
    expect(stats.queueDepth).toBe(0); // drained
    expect(stats.circuitOpen).toBe(false);
    expect(stats.circuitOpenUntil).toBe(0);
  });
});

// ===========================================================================
// retry + backoff timing (deliverWithRetry / retryDelay) with fake timers
// ===========================================================================

describe("retry and backoff", () => {
  it("retries up to maxRetries then succeeds, counting each retry exactly", async () => {
    resetLoggerMetaStats();
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async () => {
      if (logBatch.mock.calls.length <= 2) throw new Error("transient");
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      { maxBatchSize: 10, flushIntervalMs: 0, maxRetries: 2, retryBaseDelayMs: 0 },
    );

    transport.log?.(event, createContext());
    await transport.flush?.();

    // attempt 0 fail, attempt 1 fail, attempt 2 succeed => 3 calls, 2 retries.
    expect(logBatch).toHaveBeenCalledTimes(3);
    const stats = transport.stats();
    expect(stats.retryCount).toBe(2);
    expect(stats.retryExhausted).toBe(0);
    expect(stats.flushes).toBe(1);
    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry": 2 });
  });

  it("waits exactly retryBaseDelayMs * 2**attempt (random()=1) between attempts", async () => {
    vi.useFakeTimers();
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async () => {
      throw new Error("always down");
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        maxBatchSize: 10,
        flushIntervalMs: 0,
        maxRetries: 2,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 100_000, // high cap so attempts are not clamped
        random: () => 1, // delay === cap exactly
      },
    );

    transport.log?.(event, createContext());
    const flushPromise = transport.flush?.();
    // Swallow the eventual rejection so it does not surface as unhandled.
    const settled = flushPromise?.catch(() => "rejected");

    // attempt 0 runs synchronously-ish then sleeps cap = min(100000, 100*1)=100.
    await vi.advanceTimersByTimeAsync(0);
    expect(logBatch).toHaveBeenCalledTimes(1);

    // 99ms is not enough to release the first backoff.
    await vi.advanceTimersByTimeAsync(99);
    expect(logBatch).toHaveBeenCalledTimes(1);
    // The 100th ms releases it -> attempt 1.
    await vi.advanceTimersByTimeAsync(1);
    expect(logBatch).toHaveBeenCalledTimes(2);

    // attempt 1 sleeps cap = min(100000, 100*2)=200.
    await vi.advanceTimersByTimeAsync(199);
    expect(logBatch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(logBatch).toHaveBeenCalledTimes(3); // attempt 2 (== maxRetries) -> no further sleep

    await expect(settled).resolves.toBe("rejected");
    expect(transport.stats().retryCount).toBe(2);
    expect(transport.stats().retryExhausted).toBe(1);
  });

  it("clamps the backoff at retryMaxDelayMs", async () => {
    vi.useFakeTimers();
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async () => {
      throw new Error("down");
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        maxBatchSize: 10,
        flushIntervalMs: 0,
        maxRetries: 1,
        retryBaseDelayMs: 100,
        retryMaxDelayMs: 50, // cap below base => min(50, 100) = 50
        random: () => 1,
      },
    );

    transport.log?.(event, createContext());
    const settled = transport.flush?.()?.catch(() => "rejected");

    await vi.advanceTimersByTimeAsync(0);
    expect(logBatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(49);
    expect(logBatch).toHaveBeenCalledTimes(1); // not yet (cap is 50, not 100)
    await vi.advanceTimersByTimeAsync(1);
    expect(logBatch).toHaveBeenCalledTimes(2);

    await expect(settled).resolves.toBe("rejected");
  });

  it("re-queues a failed batch (failed items return to the front of the queue)", async () => {
    resetLoggerMetaStats();
    let failNext = true;
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        async logBatch(events) {
          if (failNext) {
            failNext = false;
            throw new Error("first flush fails");
          }
          batches.push(events.map((e) => e.id));
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0, maxRetries: 0 },
    );

    const context = createContext();
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);

    // First flush throws; the batch is unshifted back so the queue is restored.
    await expect(transport.flush?.()).rejects.toThrow("first flush fails");
    expect(transport.stats().flushErrors).toBe(1);
    expect(transport.stats().queueDepth).toBe(2); // re-queued

    // Second flush succeeds and delivers the same items in order.
    await transport.flush?.();
    expect(batches).toEqual([["evt-1", "evt-2"]]);
    expect(transport.stats().queueDepth).toBe(0);
    expect(transport.stats().flushes).toBe(1);
  });
});

// ===========================================================================
// circuit breaker (deliverWithRetry threshold + flush short-circuit) fake timers
// ===========================================================================

describe("circuit breaker", () => {
  it("opens after consecutive failures reach the threshold and reports circuitOpenUntil", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async () => {
      throw new Error("delivery down");
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        maxBatchSize: 10,
        flushIntervalMs: 0,
        maxRetries: 0,
        retryBaseDelayMs: 0,
        circuitBreakerFailureThreshold: 1,
        circuitBreakerResetMs: 10_000,
      },
    );

    transport.log?.(event, createContext());
    await expect(transport.flush?.()).rejects.toThrow("delivery down");

    const stats = transport.stats();
    expect(stats.retryExhausted).toBe(1);
    expect(stats.circuitOpen).toBe(true);
    // Date.now() is 0 (fake), reset is 10_000 => circuitOpenUntil = 10_000.
    expect(stats.circuitOpenUntil).toBe(10_000);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry.exhausted": 1,
      "transport.circuit.open": 1,
    });
  });

  it("does NOT open the circuit when failures stay below the threshold", async () => {
    resetLoggerMetaStats();
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async () => {
      throw new Error("down");
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        maxBatchSize: 10,
        flushIntervalMs: 0,
        maxRetries: 0,
        retryBaseDelayMs: 0,
        circuitBreakerFailureThreshold: 2, // need 2 consecutive failures
        circuitBreakerResetMs: 10_000,
      },
    );

    transport.log?.(event, createContext());
    await expect(transport.flush?.()).rejects.toThrow("down");

    const stats = transport.stats();
    expect(stats.retryExhausted).toBe(1);
    expect(stats.circuitOpen).toBe(false); // 1 failure < threshold 2
    expect(stats.circuitOpenUntil).toBe(0);
    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry.exhausted": 1 });
    expect(getLoggerMetaStats()["transport.circuit.open"]).toBeUndefined();
  });

  it("short-circuits flush while the breaker is open, then drains after reset elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    let openWindowFailing = true;
    const batches: string[][] = [];
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async (events) => {
      if (openWindowFailing) throw new Error("down");
      batches.push(events.map((e) => e.id));
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        maxBatchSize: 10,
        flushIntervalMs: 0,
        maxRetries: 0,
        retryBaseDelayMs: 0,
        circuitBreakerFailureThreshold: 1,
        circuitBreakerResetMs: 5_000,
      },
    );

    const context = createContext();
    transport.log?.(event, context);
    await expect(transport.flush?.()).rejects.toThrow("down");
    expect(transport.stats().circuitOpen).toBe(true);
    expect(transport.stats().circuitOpenUntil).toBe(5_000);

    // While open (now=0 < 5000), enqueue another item; a manual flush must NOT
    // call the inner transport again.
    openWindowFailing = false;
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    await transport.flush?.();
    expect(logBatch).toHaveBeenCalledTimes(1); // still just the failed first call
    expect(batches).toEqual([]);
    expect(transport.stats().queueDepth).toBe(2); // both items still queued

    // Advance past the reset window so circuitOpenUntil (5000) is no longer > now.
    vi.setSystemTime(5_001);
    await transport.flush?.();
    expect(logBatch).toHaveBeenCalledTimes(2);
    expect(batches).toEqual([["evt-1", "evt-2"]]);
    expect(transport.stats().circuitOpen).toBe(false);
    expect(transport.stats().circuitOpenUntil).toBe(0);
  });
});

// ===========================================================================
// concurrency > 1 + flush()/close() draining
// ===========================================================================

describe("concurrency and draining", () => {
  it("runs up to `concurrency` overlapping flushes and no more", async () => {
    const batches: string[][] = [];
    let active = 0;
    let maxActive = 0;
    const transport = batchTransport(
      {
        name: "inner",
        async logBatch(events) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          batches.push(events.map((item) => item.id));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
        },
      },
      {
        maxBatchSize: 10,
        maxBytes: 1, // 1 byte budget => one item per batch
        concurrency: 3,
        flushIntervalMs: 0,
        estimateEventBytes() {
          return 1;
        },
      },
    );

    const context = createContext();
    for (let i = 1; i <= 5; i++) {
      transport.log?.({ ...event, id: `evt-${i}`, seq: i }, context);
    }
    await transport.flush?.();

    expect(maxActive).toBe(3); // capped at concurrency
    expect(batches).toEqual([["evt-1"], ["evt-2"], ["evt-3"], ["evt-4"], ["evt-5"]]);
  });

  it("clamps concurrency to a floor of 1 (Math.max(1, floor(...)))", async () => {
    const batches: string[][] = [];
    let active = 0;
    let maxActive = 0;
    const transport = batchTransport(
      {
        name: "inner",
        async logBatch(events) {
          active += 1;
          maxActive = Math.max(maxActive, active);
          batches.push(events.map((item) => item.id));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
        },
      },
      {
        maxBatchSize: 10,
        maxBytes: 1,
        concurrency: 0, // floored to 1
        flushIntervalMs: 0,
        estimateEventBytes() {
          return 1;
        },
      },
    );

    const context = createContext();
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    await transport.flush?.();

    expect(maxActive).toBe(1);
    expect(batches).toEqual([["evt-1"], ["evt-2"]]);
  });

  it("flush() drains the queue and also calls inner.flush", async () => {
    const innerFlush = vi.fn<() => void>();
    const delivered: string[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          for (const e of events) delivered.push(e.id);
        },
        flush: innerFlush,
      },
      { maxBatchSize: 10, flushIntervalMs: 1_000_000 },
    );

    transport.log?.(event, createContext());
    await transport.flush?.();

    expect(delivered).toEqual(["evt-1"]);
    expect(innerFlush).toHaveBeenCalledTimes(1);
    expect(transport.stats().queueDepth).toBe(0);
  });

  it("coalesces two concurrent flush() calls into a single in-flight flush", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const transport = batchTransport(
      {
        name: "inner",
        async logBatch() {
          calls += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 1_000_000 },
    );

    transport.log?.(event, createContext());

    // Two overlapping flush() calls: the second must see activeFlush and reuse
    // it rather than starting a second delivery.
    const first = transport.flush?.();
    const second = transport.flush?.();
    await Promise.resolve();
    expect(calls).toBe(1); // only one delivery launched

    release?.();
    await Promise.all([first, second]);
    expect(calls).toBe(1); // still exactly one
    expect(transport.stats().flushes).toBe(1);
  });

  it("is a no-op flush when the queue is empty (queue.length === 0 guard)", async () => {
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>();
    const transport = batchTransport(
      { name: "inner", logBatch },
      { maxBatchSize: 10, flushIntervalMs: 1_000_000 },
    );

    // No items enqueued: flush must return without touching the inner transport.
    await transport.flush?.();
    expect(logBatch).not.toHaveBeenCalled();
    expect(transport.stats().flushes).toBe(0);
  });

  it("close() drains the queue and calls inner.close", async () => {
    const innerClose = vi.fn<() => void>();
    const delivered: string[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          for (const e of events) delivered.push(e.id);
        },
        close: innerClose,
      },
      { maxBatchSize: 10, flushIntervalMs: 1_000_000 },
    );

    transport.log?.(event, createContext());
    await transport.close?.();

    expect(delivered).toEqual(["evt-1"]);
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(transport.stats().queueDepth).toBe(0);
  });
});

// ===========================================================================
// transportName interpolation + gauge naming (line 176 + every gauge string
// literal). Asserting the exact gauge keys pins both `batch(${inner.name})`
// interpolation and each setLoggerMetaGauge name template.
// ===========================================================================

describe("transportName and gauge naming", () => {
  it("names gauges batch(<inner.name>) for queue depth, active batches, circuit, and flush duration", async () => {
    resetLoggerMetaStats();
    const transport = batchTransport(
      { name: "inner", logBatch() {} },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createContext();
    transport.log?.(event, context);
    // Before flush the queue-depth gauge already exists under the named key.
    expect(getLoggerMetaGauges()["transport.queue.depth.batch(inner)"]).toBe(1);

    await transport.flush?.();

    const gauges = getLoggerMetaGauges();
    // queue depth drained back to 0 under the SAME named key (kills the empty
    // gauge-name mutant at line 200 and the transportName interpolation).
    expect(gauges["transport.queue.depth.batch(inner)"]).toBe(0);
    // active batches settled to 0 (kills the active_batches gauge-name mutants
    // at 343/351 and the transportName interpolation).
    expect(gauges["transport.active_batches.batch(inner)"]).toBe(0);
    // circuit gauge written by updateCircuit -> 0 while closed (kills 207 + 203).
    expect(gauges["transport.circuit.open.batch(inner)"]).toBe(0);
    // flush duration gauge written in flush() finally (kills the 415 name + 413).
    expect(gauges["transport.flush.duration_ms.batch(inner)"]).toBeDefined();
    // No gauge was written under an empty key.
    expect(gauges[""]).toBeUndefined();
  });

  it("falls back to batch(transport) when the inner transport has no name", async () => {
    const reported: ReportedError[] = [];
    const transport = batchTransport(
      // No `name` on the inner transport => fallback string "transport".
      { logBatch() {} },
      { maxBatchSize: 10, maxQueueSize: 1, flushIntervalMs: 0, dropPolicy: "throw" },
    );

    const context = createReportingContext(reported);
    transport.log?.(event, context); // queue size 1 (full)
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // overflow => throw policy report

    expect(reported).toHaveLength(1);
    expect(reported[0]?.detail?.transport).toBe("batch(transport)");
  });

  it("uses an explicit options.name verbatim instead of deriving from inner", async () => {
    resetLoggerMetaStats();
    const transport = batchTransport(
      { name: "inner", logBatch() {} },
      { name: "myBatch", maxBatchSize: 10, flushIntervalMs: 0 },
    );

    transport.log?.(event, createContext());
    await transport.flush?.();

    const gauges = getLoggerMetaGauges();
    expect(gauges["transport.queue.depth.myBatch"]).toBe(0);
    // The derived name must NOT be used when options.name is supplied.
    expect(gauges["transport.queue.depth.batch(inner)"]).toBeUndefined();
  });
});

// ===========================================================================
// Timer-scheduled flush (schedule) + its error-reporting catch (lines 222-236).
// A finite flushIntervalMs schedules a deferred flush; advancing fake timers
// past the interval fires it. When the inner transport throws, the scheduled
// flush's catch must report with the EXACT detail object.
// ===========================================================================

describe("timer-scheduled flush", () => {
  it("fires a deferred flush after flushIntervalMs and delivers the queued batch", async () => {
    vi.useFakeTimers();
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((e) => e.id));
        },
      },
      // Below maxBatchSize so only the timer (schedule) can trigger the flush.
      { maxBatchSize: 10, flushIntervalMs: 1000 },
    );

    transport.log?.(event, createContext());
    // Not yet: 999ms is short of the interval.
    await vi.advanceTimersByTimeAsync(999);
    expect(batches).toEqual([]);
    // The 1000th ms releases the scheduled flush.
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toEqual([["evt-1"]]);
  });

  it("reports the scheduled-flush failure with exact { phase, transport, operation } detail", async () => {
    vi.useFakeTimers();
    const reported: ReportedError[] = [];
    const failure = new Error("scheduled flush down");
    const transport = batchTransport(
      {
        name: "inner",
        logBatch() {
          throw failure;
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 1000 },
    );

    transport.log?.(event, createReportingContext(reported));
    // Drive the TIMER-triggered flush (not a manual flush) past the interval.
    await vi.advanceTimersByTimeAsync(1000);

    expect(reported).toHaveLength(1);
    expect(reported[0]?.error).toBe(failure);
    expect(reported[0]?.detail).toEqual({
      phase: "transport",
      transport: "batch(inner)",
      operation: "flush",
    });
  });

  it("does not schedule a timer when flushIntervalMs is 0 (delayMs <= 0 guard)", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((e) => e.id));
        },
      },
      // flushIntervalMs 0 => schedule() must early-return without arming a timer.
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    transport.log?.(event, createContext());
    expect(setTimeoutSpy).not.toHaveBeenCalled();

    // Advancing time delivers nothing because no timer was ever armed; only a
    // manual flush drains the queue.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(batches).toEqual([]);
    await transport.flush?.();
    expect(batches).toEqual([["evt-1"]]);

    setTimeoutSpy.mockRestore();
  });

  it("arms only a single timer for multiple sub-threshold enqueues (timer !== undefined guard)", async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const batches: string[][] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          batches.push(events.map((e) => e.id));
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 1000 },
    );

    const context = createContext();
    transport.log?.(event, context); // arms the timer
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // timer already armed -> no 2nd
    transport.log?.({ ...event, id: "evt-3", seq: 3 }, context);
    // Exactly one timer scheduled across the three sub-threshold enqueues.
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    // The single scheduled flush drains all three items in one batch.
    expect(batches).toEqual([["evt-1", "evt-2", "evt-3"]]);

    setTimeoutSpy.mockRestore();
  });
});

// ===========================================================================
// flushAndReport (size-triggered flush) error path — line 498-505.
// Reaching maxBatchSize triggers flushAndReport; if the inner transport throws
// the catch must report with the exact detail object.
// ===========================================================================

describe("size-triggered flush error reporting", () => {
  it("reports the failure of a size-triggered flush with exact detail", async () => {
    const reported: ReportedError[] = [];
    const failure = new Error("size flush down");
    const transport = batchTransport(
      {
        name: "inner",
        logBatch() {
          throw failure;
        },
      },
      // flushIntervalMs huge so only the size-trigger (flushAndReport) can fire.
      { maxBatchSize: 1, flushIntervalMs: 1_000_000 },
    );

    const context = createReportingContext(reported);
    transport.log?.(event, context); // length 1 >= maxBatchSize 1 -> flushAndReport
    // Let the floating flush promise reject and reach flushAndReport's catch.
    await flushMicrotasks();

    expect(reported).toHaveLength(1);
    expect(reported[0]?.error).toBe(failure);
    expect(reported[0]?.detail).toEqual({
      phase: "transport",
      transport: "batch(inner)",
      operation: "flush",
    });
    expect(transport.stats().flushErrors).toBe(1);
  });
});

// ===========================================================================
// throw-policy overflow detail (reportDrop, lines 435-441).
// The throw policy reports an internal error with phase/transport/reason; pin
// the exact detail object and the literal reason value.
// ===========================================================================

describe("throw-policy drop detail", () => {
  it("reports the overflow drop with exact { phase, transport, reason } detail", async () => {
    const reported: ReportedError[] = [];
    const transport = batchTransport(
      { name: "inner", logBatch() {} },
      { maxBatchSize: 10, maxQueueSize: 1, flushIntervalMs: 0, dropPolicy: "throw" },
    );

    const context = createReportingContext(reported);
    transport.log?.(event, context); // queue size 1 (full)
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // overflow -> reported

    expect(reported).toHaveLength(1);
    const reportedError = reported[0]?.error as Error;
    expect(reportedError.message).toBe("loggerjs batch transport dropped log: queue-full");
    expect(reported[0]?.detail).toEqual({
      phase: "transport",
      transport: "batch(inner)",
      reason: "queue-full",
    });
  });

  it("does NOT report for non-throw policies on overflow", () => {
    const reported: ReportedError[] = [];
    const transport = batchTransport(
      { name: "inner", logBatch() {} },
      { maxBatchSize: 10, maxQueueSize: 1, flushIntervalMs: 0, dropPolicy: "drop-newest" },
    );

    const context = createReportingContext(reported);
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context); // dropped silently

    expect(reported).toEqual([]);
  });
});

// ===========================================================================
// deliver() routing across mixed/record/event batches (lines 272-291).
// recordsOnly/eventsOnly use Array.every; the three routing branches choose
// records-vs-events delivery. These assert WHICH inner method received the
// payloads so flipping every/some, ===/!==, ||/&&, or true/false flips a check.
// ===========================================================================

describe("deliver routing", () => {
  it("routes a record-only batch to writeBatch, not logBatch", async () => {
    const written: number[] = [];
    const logged: string[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        writeBatch(records) {
          for (const r of records) written.push(r.seq);
        },
        logBatch(events) {
          for (const e of events) logged.push(e.id);
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createRecordContext();
    transport.write?.(createRecord({ time: 1, level: 30, msg: "a", seq: 1 }), context);
    transport.write?.(createRecord({ time: 1, level: 30, msg: "b", seq: 2 }), context);
    await transport.flush?.();

    expect(written).toEqual([1, 2]);
    expect(logged).toEqual([]);
  });

  it("routes an event-only batch to logBatch, not writeBatch", async () => {
    const written: number[] = [];
    const logged: string[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        writeBatch(records) {
          for (const r of records) written.push(r.seq);
        },
        logBatch(events) {
          for (const e of events) logged.push(e.id);
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createContext();
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    await transport.flush?.();

    expect(logged).toEqual(["evt-1", "evt-2"]);
    expect(written).toEqual([]);
  });

  it("routes a mixed event+record batch through records when inner is record-capable", async () => {
    const written: number[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        writeBatch(records) {
          for (const r of records) written.push(r.seq);
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createContext();
    // One event + one record => neither recordsOnly nor eventsOnly; the
    // record-capable fallback (line 286) projects everything to records.
    transport.log?.(event, context); // seq 1 (event)
    transport.write?.(createRecord({ time: 1, level: 30, msg: "r", seq: 2 }), context); // record
    await transport.flush?.();

    expect(written).toEqual([1, 2]);
  });

  it("routes a mixed batch through events when inner is event-only", async () => {
    const seen: { id: string; seq: number }[] = [];
    const transport = batchTransport(
      {
        name: "inner",
        logBatch(events) {
          for (const e of events) seen.push({ id: e.id, seq: e.seq });
        },
      },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createContext();
    transport.log?.(event, context); // event (seq 1)
    transport.write?.(createRecord({ time: 1, level: 30, msg: "r", seq: 2 }), context); // record
    await transport.flush?.();

    // Mixed batch, inner has no write* => final fallback projects to events; the
    // record is converted via context.toEvent (seq preserved).
    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ id: "evt-1", seq: 1 });
    expect(seen[1]?.seq).toBe(2);
  });
});

// ===========================================================================
// deliverEvents / deliverRecords single-method fallbacks (lines 250-269).
// When inner exposes only the singular log/write (no batch form), the loop
// must call it once per item, in order.
// ===========================================================================

describe("single-method delivery fallbacks", () => {
  it("falls back to inner.log per-event when no logBatch is present", async () => {
    const logged: string[] = [];
    const log = vi.fn<NonNullable<Transport["log"]>>((e: LogEvent) => {
      logged.push(e.id);
    });
    const transport = batchTransport(
      { name: "inner", log },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createContext();
    transport.log?.(event, context);
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);
    await transport.flush?.();

    expect(log).toHaveBeenCalledTimes(2);
    expect(logged).toEqual(["evt-1", "evt-2"]);
  });

  it("falls back to inner.write per-record when no writeBatch is present", async () => {
    const seqs: number[] = [];
    const write = vi.fn<NonNullable<Transport["write"]>>((r: LogRecord) => {
      seqs.push(r.seq);
    });
    const transport = batchTransport(
      { name: "inner", write },
      { maxBatchSize: 10, flushIntervalMs: 0 },
    );

    const context = createRecordContext();
    transport.write?.(createRecord({ time: 1, level: 30, msg: "a", seq: 1 }), context);
    transport.write?.(createRecord({ time: 1, level: 30, msg: "b", seq: 2 }), context);
    await transport.flush?.();

    expect(write).toHaveBeenCalledTimes(2);
    expect(seqs).toEqual([1, 2]);
  });
});

// ===========================================================================
// circuit-open re-scheduling inside flush() and flushLoop (lines 361-362,
// 397-398, 421-423). While the circuit is open, flush short-circuits and
// schedules a retry exactly circuitOpenUntil-now in the future.
// ===========================================================================

describe("circuit-open re-scheduling", () => {
  it("schedules the drain at exactly circuitOpenUntil-now while the breaker is open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let failing = true;
    const batches: string[][] = [];
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async (events) => {
      if (failing) throw new Error("down");
      batches.push(events.map((e) => e.id));
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        maxBatchSize: 10,
        flushIntervalMs: 1_000_000, // huge so only the circuit re-schedule matters
        maxRetries: 0,
        retryBaseDelayMs: 0,
        circuitBreakerFailureThreshold: 1,
        circuitBreakerResetMs: 5000,
      },
    );

    const context = createContext();
    transport.log?.(event, context);
    await expect(transport.flush?.()).rejects.toThrow("down");
    expect(transport.stats().circuitOpenUntil).toBe(5000);

    // Recovery: future deliveries would succeed, but the breaker is open.
    failing = false;
    transport.log?.({ ...event, id: "evt-2", seq: 2 }, context);

    // A flush re-armed a timer for circuitOpenUntil - now = 5000 - 0 = 5000.
    // Advancing 4999ms must NOT drain (proves delay is 5000, not 0 or +now).
    await vi.advanceTimersByTimeAsync(4999);
    expect(batches).toEqual([]);
    // The 5000th ms fires the rescheduled flush which now succeeds.
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toEqual([["evt-1", "evt-2"]]);
  });
});

// ===========================================================================
// flush() re-arms a follow-up timer when the queue is not fully drained
// (lines 421-423: if (queue.length > 0) schedule(flushIntervalMs)).
// ===========================================================================

describe("flush leftover re-scheduling", () => {
  it("re-schedules a follow-up flush at flushIntervalMs after a failed flush re-queues items", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let failNext = true;
    const batches: string[][] = [];
    const logBatch = vi.fn<NonNullable<Transport["logBatch"]>>(async (events) => {
      if (failNext) {
        failNext = false;
        throw new Error("first flush fails");
      }
      batches.push(events.map((e) => e.id));
    });
    const transport = batchTransport(
      { name: "inner", logBatch },
      {
        // No circuit so the leftover delay is flushIntervalMs (NOT circuit-based).
        maxBatchSize: 10,
        flushIntervalMs: 300,
        maxRetries: 0,
      },
    );

    const context = createContext();
    transport.log?.(event, context);
    // First flush fails -> batch re-queued -> finally sees queue.length>0 and
    // schedules a follow-up at flushIntervalMs (300ms), circuit closed.
    await expect(transport.flush?.()).rejects.toThrow("first flush fails");
    expect(transport.stats().queueDepth).toBe(1);
    expect(batches).toEqual([]);

    // 299ms is short of the re-scheduled delay.
    await vi.advanceTimersByTimeAsync(299);
    expect(batches).toEqual([]);
    // The 300th ms fires the rescheduled flush which now succeeds.
    await vi.advanceTimersByTimeAsync(1);
    expect(batches).toEqual([["evt-1"]]);
  });
});
