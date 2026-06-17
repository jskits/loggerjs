import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRecord,
  fallbackTransport,
  getLoggerMetaStats,
  recordToEvent,
  resetLoggerMetaStats,
  retryTransport,
  type FallbackTransportOptions,
  type LogEvent,
  type RetryTransportOptions,
  type Transport,
  type TransportContext,
} from "../src";

type FallbackOnFallback = NonNullable<FallbackTransportOptions["onFallback"]>;

// ---------------------------------------------------------------------------
// Shared fixtures (mirrors reliability-transport.test.ts style/helpers).
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

const secondEvent: LogEvent = {
  id: "evt-2",
  time: 2,
  seq: 2,
  level: 30,
  levelName: "info",
  logger: "test",
  message: "updated",
};

const record = createRecord({
  time: 1,
  level: 30,
  category: "test",
  msg: "created",
  seq: 1,
});

const secondRecord = createRecord({
  time: 2,
  level: 30,
  category: "test",
  msg: "updated",
  seq: 2,
});

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

afterEach(() => {
  vi.useRealTimers();
});

// ===========================================================================
// retryDelay (exercised via the backoff path of retryTransport).
//
// retryDelay(attempt, base, max, random) =
//   const cap = Math.min(max, base * 2 ** attempt);
//   return cap <= 0 ? 0 : random() * cap;
//
// We drive it through real retries using fake timers so the EXACT delay before
// each retry is pinned (advance-to-(delay-1) => no retry, advance-to-delay =>
// retry). This kills mutants on: `2 ** attempt` (exponent base/operator),
// `Math.min` (cap selection), `base * ...`, `random() * cap`, `cap <= 0`.
// ===========================================================================

describe("retryDelay (exponential backoff, exact ms boundaries)", () => {
  it("doubles the delay each attempt: base*2^0, base*2^1, base*2^2 (factor 2 pinned)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();

    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log(next) {
        attempts.push(Date.now());
        // Fail on the first 3 attempts, succeed on the 4th (index 3).
        if (attempts.length <= 3) throw new Error(`boom ${attempts.length}`);
        void next;
      },
    };

    // base=10, max=1000 so the cap never clamps for attempts 0..2.
    // Delays: attempt0 -> 10*2^0=10, attempt1 -> 10*2^1=20, attempt2 -> 10*2^2=40.
    // random() => 1 makes the delay deterministic (= cap exactly).
    const delivery = retryTransport(inner, {
      maxRetries: 3,
      retryBaseDelayMs: 10,
      retryMaxDelayMs: 1000,
      random: () => 1,
    }).log?.(event, createContext());

    await Promise.resolve();
    expect(attempts).toEqual([0]); // first attempt at t=0

    // --- Retry #1 scheduled at delay = 10ms ---
    await vi.advanceTimersByTimeAsync(9);
    expect(attempts).toEqual([0]); // delay-1 => still no retry
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 10]); // exactly 10ms => retry fires

    // --- Retry #2 scheduled at delay = 20ms (so absolute t=30) ---
    await vi.advanceTimersByTimeAsync(19);
    expect(attempts).toEqual([0, 10]); // delay-1 => no retry
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 10, 30]); // exactly 20ms later => retry

    // --- Retry #3 scheduled at delay = 40ms (so absolute t=70) ---
    await vi.advanceTimersByTimeAsync(39);
    expect(attempts).toEqual([0, 10, 30]); // delay-1 => no retry
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 10, 30, 70]); // exactly 40ms later => success

    await delivery;

    // 3 retries scheduled => transport.retry counted exactly 3 times.
    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry": 3 });
    // Success path resets failures; no exhaustion / circuit counters.
    expect(getLoggerMetaStats()["transport.retry.exhausted"]).toBeUndefined();
  });

  it("clamps the delay to retryMaxDelayMs via Math.min (cap pinned)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();

    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(Date.now());
        if (attempts.length === 1) throw new Error("boom");
      },
    };

    // base=100, attempt0 => 100*2^0 = 100, but max=30 so Math.min(30,100)=30.
    const delivery = retryTransport(inner, {
      maxRetries: 1,
      retryBaseDelayMs: 100,
      retryMaxDelayMs: 30,
      random: () => 1,
    }).log?.(event, createContext());

    await Promise.resolve();
    expect(attempts).toEqual([0]);

    await vi.advanceTimersByTimeAsync(29);
    expect(attempts).toEqual([0]); // not at 100 (would be base), clamped to 30
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 30]); // retry exactly at the clamped 30ms

    await delivery;
  });

  it("scales the delay by random()*cap (jitter source stubbed; half the cap)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();

    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(Date.now());
        if (attempts.length === 1) throw new Error("boom");
      },
    };

    // base=200, attempt0 => cap=200, random()=0.5 => delay=100.
    const delivery = retryTransport(inner, {
      maxRetries: 1,
      retryBaseDelayMs: 200,
      retryMaxDelayMs: 1000,
      random: () => 0.5,
    }).log?.(event, createContext());

    await Promise.resolve();
    expect(attempts).toEqual([0]);

    await vi.advanceTimersByTimeAsync(99);
    expect(attempts).toEqual([0]); // delay-1 => no retry (not full cap 200)
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 100]); // exactly random()*cap = 0.5*200 = 100

    await delivery;
  });

  it("treats a non-positive cap as a zero delay (cap<=0 branch, sleep short-circuits)", async () => {
    // base=0 => cap = Math.min(max, 0) = 0 => `cap <= 0 ? 0 : ...` returns 0,
    // and sleep(0) resolves synchronously (no timer). With real timers and an
    // immediate microtask flush the retry happens with no advanceTimers call.
    resetLoggerMetaStats();
    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(1);
        if (attempts.length === 1) throw new Error("boom");
      },
    };

    await retryTransport(inner, {
      maxRetries: 1,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 1000,
      random: () => 1, // even with random=1, cap is 0 so delay is 0
    }).log?.(event, createContext());

    // The retry fires with no timer advance: sleep(0) resolved synchronously.
    // (The delayMs===0 value itself is pinned by the next test, which wires
    // onRetry; asserting it here without passing onRetry was a no-op.)
    expect(attempts).toHaveLength(2);
    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry": 1 });
  });

  it("passes delayMs===0 to onRetry when the cap collapses to zero", async () => {
    resetLoggerMetaStats();
    const onRetry = vi.fn<NonNullable<RetryTransportOptions["onRetry"]>>();
    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(1);
        if (attempts.length === 1) throw new Error("boom");
      },
    };

    await retryTransport(inner, {
      maxRetries: 1,
      retryBaseDelayMs: 0,
      random: () => 1,
      onRetry,
    }).log?.(event, createContext());

    // attempt index 0 => onRetry reports attempt:0+1=1, delayMs:0 exactly.
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({
      attempt: 1,
      delayMs: 0,
      error: expect.any(Error),
    });
  });
});

// ===========================================================================
// retryTransport: onRetry attempt numbering across multiple retries.
// Pins `attempt + 1` (line 249) and the loop increment `attempt += 1`.
// ===========================================================================

describe("retryTransport onRetry numbering", () => {
  it("reports attempt as (zero-based index + 1) on each retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const onRetry = vi.fn<NonNullable<RetryTransportOptions["onRetry"]>>();

    const inner: Transport = {
      name: "remote",
      log() {
        throw new Error("always");
      },
    };

    const primaryError = new Error("final");
    const fallbackHits: string[] = [];
    const fallback: Transport = {
      name: "local",
      log(next) {
        fallbackHits.push(next.id);
      },
    };

    const delivery = retryTransport(inner, {
      maxRetries: 2,
      retryBaseDelayMs: 5,
      retryMaxDelayMs: 1000,
      random: () => 1,
      fallback,
      onRetry,
    }).log?.(event, createContext());

    // attempt0 fails -> retry#1 (delay 5)
    await vi.advanceTimersByTimeAsync(5);
    // attempt1 fails -> retry#2 (delay 10)
    await vi.advanceTimersByTimeAsync(10);
    // attempt2 fails -> attempt(2) >= maxRetries(2) => exhausted, fallback.
    await delivery;
    void primaryError;

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      delayMs: 5,
      error: expect.any(Error),
    });
    expect(onRetry).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      delayMs: 10,
      error: expect.any(Error),
    });
    expect(fallbackHits).toEqual(["evt-1"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry": 2,
      "transport.retry.exhausted": 1,
      "transport.fallback": 1,
    });
  });
});

// ===========================================================================
// retryTransport: circuit breaker EXACT threshold + reset-window boundaries.
//
//   if (consecutiveFailures >= circuitBreakerFailureThreshold) open;
//   if (circuitOpenUntil > now) short-circuit;
//   circuitOpenUntil = Date.now() + circuitBreakerResetMs;
// ===========================================================================

describe("retryTransport circuit breaker threshold boundary", () => {
  it("stays CLOSED at threshold-1 failures, OPENS exactly at the threshold", async () => {
    resetLoggerMetaStats();
    let failing = true;
    const primaryCalls: string[] = [];
    const primary: Transport = {
      name: "remote",
      log(next) {
        primaryCalls.push(next.id);
        if (failing) throw new Error("down");
      },
    };
    const fallbackCalls: string[] = [];
    const fallback: Transport = {
      name: "local",
      log(next) {
        fallbackCalls.push(next.id);
      },
    };

    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 3,
      circuitBreakerResetMs: 10_000,
      fallback,
    });
    const ctx = createContext();

    // Failure #1 (consecutive=1, 1 >= 3 false => circuit stays closed)
    await transport.log?.({ ...event, id: "f1" }, ctx);
    // Failure #2 (consecutive=2, 2 >= 3 false => still closed)
    await transport.log?.({ ...event, id: "f2" }, ctx);

    // After 2 failures (threshold-1) the circuit must NOT be open: primary is
    // still being called on the next attempt.
    expect(primaryCalls).toEqual(["f1", "f2"]);
    expect(getLoggerMetaStats()["transport.circuit.open"]).toBeUndefined();
    expect(getLoggerMetaStats()["transport.circuit.skipped"]).toBeUndefined();

    // Failure #3 (consecutive=3, 3 >= 3 TRUE => circuit opens now)
    await transport.log?.({ ...event, id: "f3" }, ctx);
    expect(primaryCalls).toEqual(["f1", "f2", "f3"]);
    expect(getLoggerMetaStats()).toMatchObject({ "transport.circuit.open": 1 });

    // Next call short-circuits: primary NOT called again, goes straight to fallback.
    await transport.log?.({ ...event, id: "after-open" }, ctx);
    expect(primaryCalls).toEqual(["f1", "f2", "f3"]); // unchanged
    expect(fallbackCalls).toEqual(["f1", "f2", "f3", "after-open"]);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry.exhausted": 3,
      "transport.circuit.open": 1,
      "transport.circuit.skipped": 1,
      "transport.fallback": 4,
    });
  });

  it("keeps the circuit open until resetMs-1, half-opens exactly at resetMs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    let failing = true;
    const primaryCalls: number[] = [];
    const primary: Transport = {
      name: "remote",
      log() {
        primaryCalls.push(Date.now());
        if (failing) throw new Error("down");
      },
    };
    const fallbackCalls: string[] = [];
    const fallback: Transport = {
      name: "local",
      log(next) {
        fallbackCalls.push(next.id);
      },
    };

    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 1_000,
      fallback,
    });
    const ctx = createContext();

    // t=0: fail once => threshold 1 reached => circuitOpenUntil = 0 + 1000 = 1000.
    await transport.log?.(event, ctx);
    expect(primaryCalls).toEqual([0]);

    // t=999 (resetMs-1): circuitOpenUntil(1000) > now(999) => STILL OPEN, skipped.
    failing = false; // primary would succeed if it were called
    vi.setSystemTime(999);
    await transport.log?.({ ...event, id: "at-999" }, ctx);
    expect(primaryCalls).toEqual([0]); // primary NOT called -> proves still open
    expect(fallbackCalls).toEqual(["evt-1", "at-999"]);

    // t=1000 (resetMs): circuitOpenUntil(1000) > now(1000) is FALSE => half-open,
    // primary gets a trial and succeeds => circuit closes.
    vi.setSystemTime(1000);
    await transport.log?.({ ...event, id: "at-1000" }, ctx);
    expect(primaryCalls).toEqual([0, 1000]); // primary IS called again
    expect(fallbackCalls).toEqual(["evt-1", "at-999"]); // unchanged: success, no fallback

    expect(getLoggerMetaStats()).toMatchObject({
      "transport.circuit.open": 1,
      "transport.circuit.skipped": 1, // exactly one skip (the t=999 call)
      "transport.fallback": 2,
    });
  });

  it("re-opens the circuit when the half-open trial fails again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const primaryCalls: number[] = [];
    const primary: Transport = {
      name: "remote",
      log() {
        primaryCalls.push(Date.now());
        throw new Error("still down");
      },
    };
    const fallbackCalls: string[] = [];
    const fallback: Transport = {
      name: "local",
      log(next) {
        fallbackCalls.push(next.id);
      },
    };

    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 1_000,
      fallback,
    });
    const ctx = createContext();

    // Open at t=0 (circuitOpenUntil=1000, consecutiveFailures=1).
    await transport.log?.(event, ctx);
    expect(primaryCalls).toEqual([0]);

    // Advance to t=1000 => half-open trial; it fails -> consecutiveFailures=2,
    // 2 >= 1 => re-open with circuitOpenUntil = 1000 + 1000 = 2000.
    vi.setSystemTime(1000);
    await transport.log?.({ ...event, id: "trial" }, ctx);
    expect(primaryCalls).toEqual([0, 1000]); // trial happened

    // t=1999 (re-open window - 1): still open => skipped (primary not called).
    vi.setSystemTime(1999);
    await transport.log?.({ ...event, id: "at-1999" }, ctx);
    expect(primaryCalls).toEqual([0, 1000]); // unchanged

    expect(getLoggerMetaStats()).toMatchObject({
      "transport.circuit.open": 2, // opened at t=0 and re-opened at t=1000
      "transport.circuit.skipped": 1, // only the t=1999 call short-circuited
      "transport.retry.exhausted": 2,
      "transport.fallback": 3,
    });
    expect(fallbackCalls).toEqual(["evt-1", "trial", "at-1999"]);
  });

  it("never opens the circuit when the threshold defaults to Infinity", async () => {
    resetLoggerMetaStats();
    const primaryError = new Error("down");
    const primary: Transport = {
      name: "remote",
      log() {
        throw primaryError;
      },
    };

    const transport = retryTransport(primary, { maxRetries: 0 });

    // Many failures but default threshold is Infinity: circuit never opens.
    await expect(transport.log?.(event, createContext())).rejects.toBe(primaryError);
    await expect(transport.log?.(secondEvent, createContext())).rejects.toBe(primaryError);
    await expect(transport.log?.({ ...event, id: "evt-3" }, createContext())).rejects.toBe(
      primaryError,
    );

    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry.exhausted": 3 });
    expect(getLoggerMetaStats()["transport.circuit.open"]).toBeUndefined();
    expect(getLoggerMetaStats()["transport.circuit.skipped"]).toBeUndefined();
  });
});

// ===========================================================================
// retryTransport.deliverFallback: error===undefined branch (line 205) and the
// transport.name ?? transportName reporting fallback.
// ===========================================================================

describe("retryTransport deliverFallback error reporting", () => {
  it("reports the internal error (with inner.name) only on the primary-error path", async () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const primaryError = new Error("boom");
    const onFallback = vi.fn<NonNullable<RetryTransportOptions["onFallback"]>>();
    const primary: Transport = {
      name: "remote",
      log() {
        throw primaryError;
      },
    };
    const fallbackEvents: string[] = [];
    const fallback: Transport = {
      name: "local",
      log(next) {
        fallbackEvents.push(next.id);
      },
    };

    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 10_000,
      fallback,
      onFallback,
    });
    const ctx = createContext(errors);

    // First call: primary-error path => error is defined => reportInternalError fires.
    await transport.log?.(event, ctx);
    expect(errors).toEqual([primaryError]);
    expect(onFallback).toHaveBeenNthCalledWith(1, {
      reason: "primary-error",
      operation: "log",
      error: primaryError,
    });

    // Second call: circuit-open path => error is undefined => NO new reportInternalError,
    // and onFallback receives error: undefined.
    await transport.log?.(secondEvent, ctx);
    expect(errors).toEqual([primaryError]); // unchanged (no second report)
    expect(onFallback).toHaveBeenNthCalledWith(2, {
      reason: "circuit-open",
      operation: "log",
      error: undefined,
    });
    expect(fallbackEvents).toEqual(["evt-1", "evt-2"]);
  });

  it("uses the inner transport name in reportInternalError detail", async () => {
    resetLoggerMetaStats();
    const detail: Array<Record<string, unknown> | undefined> = [];
    const primaryError = new Error("boom");
    const primary: Transport = {
      name: "the-inner-name",
      log() {
        throw primaryError;
      },
    };
    const fallback: Transport = { name: "fb", log: vi.fn<() => void>() };
    const transport = retryTransport(primary, { maxRetries: 0, fallback });
    const ctx: TransportContext = {
      loggerName: "test",
      now: () => 1,
      toEvent: recordToEvent,
      reportInternalError(_error, d) {
        detail.push(d);
      },
    };

    await transport.log?.(event, ctx);

    expect(detail).toHaveLength(1);
    expect(detail[0]).toMatchObject({
      phase: "transport",
      transport: "the-inner-name",
      operation: "log",
      fallback: "fb",
    });
  });
});

// ===========================================================================
// retryTransport default transportName: `retry(${inner.name ?? "transport"})`.
// ===========================================================================

describe("retryTransport default name", () => {
  it("derives the circuit-open error message from inner.name", async () => {
    resetLoggerMetaStats();
    const primary: Transport = {
      name: "remote",
      log() {
        throw new Error("down");
      },
    };
    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 10_000,
      // no fallback => circuit-open path throws the circuit error using transportName
    });
    const ctx = createContext();

    await expect(transport.log?.(event, ctx)).rejects.toThrow("down");
    await expect(transport.log?.(secondEvent, ctx)).rejects.toThrow(
      "loggerjs transport circuit is open: retry(remote)",
    );
  });

  it("falls back to 'transport' in the name when inner.name is undefined", async () => {
    resetLoggerMetaStats();
    const primary: Transport = {
      log() {
        throw new Error("down");
      },
    };
    const transport = retryTransport(primary, {
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 10_000,
    });
    const ctx = createContext();

    await expect(transport.log?.(event, ctx)).rejects.toThrow("down");
    await expect(transport.log?.(secondEvent, ctx)).rejects.toThrow(
      "loggerjs transport circuit is open: retry(transport)",
    );
  });

  it("honors an explicit options.name over the derived default", async () => {
    resetLoggerMetaStats();
    const primary: Transport = {
      name: "remote",
      log() {
        throw new Error("down");
      },
    };
    const transport = retryTransport(primary, {
      name: "custom-retry",
      maxRetries: 0,
      circuitBreakerFailureThreshold: 1,
      circuitBreakerResetMs: 10_000,
    });
    expect(transport.name).toBe("custom-retry");
    const ctx = createContext();
    await expect(transport.log?.(event, ctx)).rejects.toThrow("down");
    await expect(transport.log?.(secondEvent, ctx)).rejects.toThrow(
      "loggerjs transport circuit is open: custom-retry",
    );
  });

  it("exposes inner.minLevel", () => {
    const primary: Transport = { name: "remote", minLevel: 40, log() {} };
    expect(retryTransport(primary).minLevel).toBe(40);
  });
});

// ===========================================================================
// retryTransport defaults: maxRetries defaults to 1 (one retry, two attempts).
// ===========================================================================

describe("retryTransport maxRetries default", () => {
  it("retries exactly once by default (2 total attempts) then succeeds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(Date.now());
        if (attempts.length === 1) throw new Error("first only");
      },
    };

    // No maxRetries provided => defaults to 1. base default 100, max 1000, random=1.
    const delivery = retryTransport(inner, { random: () => 1 }).log?.(event, createContext());

    await Promise.resolve();
    expect(attempts).toEqual([0]);

    // Default retryBaseDelayMs is 100 => first retry delay = 100*2^0 = 100.
    await vi.advanceTimersByTimeAsync(99);
    expect(attempts).toEqual([0]); // not yet (default base is 100, not 0)
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toEqual([0, 100]);

    await delivery;
    expect(getLoggerMetaStats()).toMatchObject({ "transport.retry": 1 });
  });

  it("exhausts after exactly maxRetries=1 default retry on persistent failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    resetLoggerMetaStats();
    const primaryError = new Error("persistent");
    const attempts: number[] = [];
    const inner: Transport = {
      name: "remote",
      log() {
        attempts.push(Date.now());
        throw primaryError;
      },
    };

    const delivery = retryTransport(inner, { random: () => 1 }).log?.(event, createContext());
    const guarded = delivery?.catch((e) => e);

    await vi.advanceTimersByTimeAsync(100); // first (and only) retry at 100ms
    const result = await guarded;

    expect(attempts).toEqual([0, 100]); // exactly 2 attempts: original + 1 retry
    expect(result).toBe(primaryError);
    expect(getLoggerMetaStats()).toMatchObject({
      "transport.retry": 1,
      "transport.retry.exhausted": 1,
    });
  });
});

// ===========================================================================
// deliver(): operation dispatch + per-operation capability fallback chains.
// Each test pins a specific branch so flipping the `if (transport.X)` guards or
// the operation === "..." comparisons changes the outcome.
// ===========================================================================

describe("deliver capability dispatch via retryTransport (maxRetries:0, no failure)", () => {
  // --- operation "write" ---
  it("write op -> uses transport.write when present", async () => {
    const seen: number[] = [];
    const t: Transport = { name: "t", write: (r) => void seen.push(r.seq) };
    await retryTransport(t, { maxRetries: 0 }).write?.(record, createContext());
    expect(seen).toEqual([1]);
  });

  it("write op -> falls to writeBatch([record]) when no write", async () => {
    const seen: number[][] = [];
    const t: Transport = {
      name: "t",
      writeBatch: (rs) => void seen.push(rs.map((r) => r.seq)),
    };
    await retryTransport(t, { maxRetries: 0 }).write?.(record, createContext());
    expect(seen).toEqual([[1]]); // exactly one batch of one record
  });

  it("write op -> falls to log(toEvent(record)) when only log", async () => {
    const seen: string[] = [];
    const t: Transport = { name: "t", log: (e) => void seen.push(e.message) };
    await retryTransport(t, { maxRetries: 0 }).write?.(record, createContext());
    expect(seen).toEqual(["created"]); // record converted to event
  });

  it("write op -> falls to logBatch([toEvent(record)]) when only logBatch", async () => {
    const seen: string[][] = [];
    const t: Transport = {
      name: "t",
      logBatch: (es) => void seen.push(es.map((e) => e.message)),
    };
    await retryTransport(t, { maxRetries: 0 }).write?.(record, createContext());
    expect(seen).toEqual([["created"]]);
  });

  // --- operation "writeBatch" ---
  it("writeBatch op -> uses transport.writeBatch when present (single batch)", async () => {
    const seen: number[][] = [];
    const t: Transport = {
      name: "t",
      writeBatch: (rs) => void seen.push(rs.map((r) => r.seq)),
    };
    await retryTransport(t, { maxRetries: 0 }).writeBatch?.(
      [record, secondRecord],
      createContext(),
    );
    expect(seen).toEqual([[1, 2]]); // one batch, both records, in order
  });

  it("writeBatch op -> falls to per-record write loop preserving order", async () => {
    const seen: number[] = [];
    const t: Transport = { name: "t", write: (r) => void seen.push(r.seq) };
    await retryTransport(t, { maxRetries: 0 }).writeBatch?.(
      [record, secondRecord],
      createContext(),
    );
    expect(seen).toEqual([1, 2]); // looped individually, in order (not [2,1])
  });

  it("writeBatch op -> falls to logBatch(events) when only logBatch", async () => {
    const seen: string[][] = [];
    const t: Transport = {
      name: "t",
      logBatch: (es) => void seen.push(es.map((e) => e.message)),
    };
    await retryTransport(t, { maxRetries: 0 }).writeBatch?.(
      [record, secondRecord],
      createContext(),
    );
    expect(seen).toEqual([["created", "updated"]]); // single logBatch, in order
  });

  it("writeBatch op -> falls to per-event log loop when only log", async () => {
    const seen: string[] = [];
    const t: Transport = { name: "t", log: (e) => void seen.push(e.message) };
    await retryTransport(t, { maxRetries: 0 }).writeBatch?.(
      [record, secondRecord],
      createContext(),
    );
    expect(seen).toEqual(["created", "updated"]); // looped, in order
  });

  // --- operation "log" ---
  it("log op -> uses transport.log when present", async () => {
    const seen: string[] = [];
    const t: Transport = { name: "t", log: (e) => void seen.push(e.id) };
    await retryTransport(t, { maxRetries: 0 }).log?.(event, createContext());
    expect(seen).toEqual(["evt-1"]);
  });

  it("log op -> falls to logBatch([event]) when only logBatch", async () => {
    const seen: string[][] = [];
    const t: Transport = {
      name: "t",
      logBatch: (es) => void seen.push(es.map((e) => e.id)),
    };
    await retryTransport(t, { maxRetries: 0 }).log?.(event, createContext());
    expect(seen).toEqual([["evt-1"]]); // exactly one batch of one event
  });

  it("log op -> falls to write(eventToRecord(event)) when only write", async () => {
    const seen: string[] = [];
    const t: Transport = { name: "t", write: (r) => void seen.push(r.msg ?? "") };
    await retryTransport(t, { maxRetries: 0 }).log?.(event, createContext());
    expect(seen).toEqual(["created"]); // event converted to record
  });

  it("log op -> falls to writeBatch([eventToRecord(event)]) when only writeBatch", async () => {
    const seen: string[][] = [];
    const t: Transport = {
      name: "t",
      writeBatch: (rs) => void seen.push(rs.map((r) => r.msg ?? "")),
    };
    await retryTransport(t, { maxRetries: 0 }).log?.(event, createContext());
    expect(seen).toEqual([["created"]]);
  });

  // --- operation "logBatch" ---
  it("logBatch op -> uses transport.logBatch when present (single batch)", async () => {
    const seen: string[][] = [];
    const t: Transport = {
      name: "t",
      logBatch: (es) => void seen.push(es.map((e) => e.id)),
    };
    await retryTransport(t, { maxRetries: 0 }).logBatch?.([event, secondEvent], createContext());
    expect(seen).toEqual([["evt-1", "evt-2"]]); // one batch, both, in order
  });

  it("logBatch op -> falls to per-event log loop preserving order", async () => {
    const seen: string[] = [];
    const t: Transport = { name: "t", log: (e) => void seen.push(e.id) };
    await retryTransport(t, { maxRetries: 0 }).logBatch?.([event, secondEvent], createContext());
    expect(seen).toEqual(["evt-1", "evt-2"]); // looped, in order (not [evt-2, evt-1])
  });

  it("logBatch op -> falls to writeBatch(records) when only writeBatch", async () => {
    const seen: string[][] = [];
    const t: Transport = {
      name: "t",
      writeBatch: (rs) => void seen.push(rs.map((r) => r.msg ?? "")),
    };
    await retryTransport(t, { maxRetries: 0 }).logBatch?.([event, secondEvent], createContext());
    expect(seen).toEqual([["created", "updated"]]); // single writeBatch, in order
  });

  it("logBatch op -> falls to per-record write loop when only write", async () => {
    const seen: string[] = [];
    const t: Transport = { name: "t", write: (r) => void seen.push(r.msg ?? "") };
    await retryTransport(t, { maxRetries: 0 }).logBatch?.([event, secondEvent], createContext());
    expect(seen).toEqual(["created", "updated"]); // looped, in order
  });

  it("write op -> no-op when transport has no delivery method (resolves, nothing thrown)", async () => {
    const t: Transport = { name: "noop" };
    await expect(
      retryTransport(t, { maxRetries: 0 }).write?.(record, createContext()),
    ).resolves.toBeUndefined();
  });

  it("logBatch op -> no-op when transport has no delivery method", async () => {
    const t: Transport = { name: "noop" };
    await expect(
      retryTransport(t, { maxRetries: 0 }).logBatch?.([event], createContext()),
    ).resolves.toBeUndefined();
  });
});

// ===========================================================================
// fallbackTransport: name default, lifecycle ordering, batch/log adaptation,
// and the primary.name ?? transportName reporting fallback.
// ===========================================================================

describe("fallbackTransport name and reporting", () => {
  it("derives the default name from primary.name", () => {
    const primary: Transport = { name: "p", log() {} };
    const fallback: Transport = { name: "f", log() {} };
    expect(fallbackTransport(primary, fallback).name).toBe("fallback(p)");
  });

  it("uses 'primary' literal in the default name when primary.name is undefined", () => {
    const primary: Transport = { log() {} };
    const fallback: Transport = { name: "f", log() {} };
    expect(fallbackTransport(primary, fallback).name).toBe("fallback(primary)");
  });

  it("honors an explicit options.name", () => {
    const primary: Transport = { name: "p", log() {} };
    const fallback: Transport = { name: "f", log() {} };
    expect(fallbackTransport(primary, fallback, { name: "my-fb" }).name).toBe("my-fb");
  });

  it("reports the internal error using primary.name when present", async () => {
    resetLoggerMetaStats();
    const details: Array<Record<string, unknown> | undefined> = [];
    const primaryError = new Error("down");
    const primary: Transport = {
      name: "primary-name",
      log() {
        throw primaryError;
      },
    };
    const fallback: Transport = { name: "fb-name", log() {} };
    const ctx: TransportContext = {
      loggerName: "test",
      now: () => 1,
      toEvent: recordToEvent,
      reportInternalError(_error, d) {
        details.push(d);
      },
    };

    await fallbackTransport(primary, fallback).log?.(event, ctx);
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      phase: "transport",
      transport: "primary-name",
      operation: "log",
      fallback: "fb-name",
    });
    expect(getLoggerMetaStats()).toMatchObject({ "transport.fallback": 1 });
  });

  it("succeeds silently when the primary works (no fallback, no error report)", async () => {
    resetLoggerMetaStats();
    const errors: unknown[] = [];
    const fallbackHits: string[] = [];
    const primaryHits: string[] = [];
    const primary: Transport = { name: "p", log: (e) => void primaryHits.push(e.id) };
    const fallback: Transport = { name: "f", log: (e) => void fallbackHits.push(e.id) };

    await fallbackTransport(primary, fallback).log?.(event, createContext(errors));

    expect(primaryHits).toEqual(["evt-1"]);
    expect(fallbackHits).toEqual([]); // fallback NOT invoked on success
    expect(errors).toEqual([]);
    expect(getLoggerMetaStats()["transport.fallback"]).toBeUndefined();
  });

  it("passes the original payload to the fallback for the 'log' operation", async () => {
    resetLoggerMetaStats();
    const fallbackHits: LogEvent[] = [];
    const primary: Transport = {
      name: "p",
      log() {
        throw new Error("down");
      },
    };
    const fallback: Transport = { name: "f", log: (e) => void fallbackHits.push(e) };

    await fallbackTransport(primary, fallback).log?.(event, createContext());
    expect(fallbackHits).toEqual([event]); // exact same event object content
  });
});

// ===========================================================================
// deliver(): last-in-chain capability guards must NOT be unconditionally true.
// A transport with NO delivery method must remain a NO-OP. If `if (transport.log)`
// (writeBatch op, line 78) or `if (transport.writeBatch)` (log op, line 92) were
// mutated to `if (true)`, calling the (undefined) method would throw a TypeError.
// ===========================================================================

describe("deliver no-op transport guards (last-in-chain guards are real)", () => {
  it("writeBatch op on an empty transport is a no-op (line 78 guard not always-true)", async () => {
    const t: Transport = { name: "empty" };
    await expect(
      retryTransport(t, { maxRetries: 0 }).writeBatch?.([record, secondRecord], createContext()),
    ).resolves.toBeUndefined();
  });

  it("log op on an empty transport is a no-op (line 92 guard not always-true)", async () => {
    const t: Transport = { name: "empty" };
    await expect(
      retryTransport(t, { maxRetries: 0 }).log?.(event, createContext()),
    ).resolves.toBeUndefined();
  });
});

// ===========================================================================
// fallbackTransport lifecycle optional-chaining: a transport WITHOUT a given
// lifecycle method must be skipped (the `?.` is real). If `primary.flush?.()`
// became `primary.flush()`, the missing method would throw a TypeError that the
// awaited call would reject with.
// ===========================================================================

describe("fallbackTransport lifecycle optional chaining is real", () => {
  it("flush() tolerates a primary missing flush() (only fallback flushes)", async () => {
    const calls: string[] = [];
    const primary: Transport = { name: "p", log() {} }; // no flush
    const fallback: Transport = {
      name: "f",
      log() {},
      async flush() {
        calls.push("fb:flush");
      },
    };
    await expect(fallbackTransport(primary, fallback).flush?.()).resolves.toBeUndefined();
    expect(calls).toEqual(["fb:flush"]);
  });

  it("flush() tolerates a fallback missing flush() (only primary flushes)", async () => {
    const calls: string[] = [];
    const primary: Transport = {
      name: "p",
      log() {},
      async flush() {
        calls.push("p:flush");
      },
    };
    const fallback: Transport = { name: "f", log() {} }; // no flush
    await expect(fallbackTransport(primary, fallback).flush?.()).resolves.toBeUndefined();
    expect(calls).toEqual(["p:flush"]);
  });

  it("flushSync() tolerates a primary and fallback missing flushSync()", () => {
    const calls: string[] = [];
    const primary: Transport = { name: "p", log() {} }; // no flushSync
    const fallback: Transport = {
      name: "f",
      log() {},
      flushSync() {
        calls.push("fb:flushSync");
      },
    };
    expect(() => fallbackTransport(primary, fallback).flushSync?.()).not.toThrow();
    expect(calls).toEqual(["fb:flushSync"]);

    const calls2: string[] = [];
    const primary2: Transport = {
      name: "p",
      log() {},
      flushSync() {
        calls2.push("p:flushSync");
      },
    };
    const fallback2: Transport = { name: "f", log() {} }; // no flushSync
    expect(() => fallbackTransport(primary2, fallback2).flushSync?.()).not.toThrow();
    expect(calls2).toEqual(["p:flushSync"]);
  });

  it("close() tolerates a primary and fallback missing close()", async () => {
    const calls: string[] = [];
    const primary: Transport = { name: "p", log() {} }; // no close
    const fallback: Transport = {
      name: "f",
      log() {},
      async close() {
        calls.push("fb:close");
      },
    };
    await expect(fallbackTransport(primary, fallback).close?.()).resolves.toBeUndefined();
    expect(calls).toEqual(["fb:close"]);

    const calls2: string[] = [];
    const primary2: Transport = {
      name: "p",
      log() {},
      async close() {
        calls2.push("p:close");
      },
    };
    const fallback2: Transport = { name: "f", log() {} }; // no close
    await expect(fallbackTransport(primary2, fallback2).close?.()).resolves.toBeUndefined();
    expect(calls2).toEqual(["p:close"]);
  });
});

// ===========================================================================
// retryTransport.logBatch operation-string literal: the "logBatch" string is
// surfaced through onFallback({ operation }). If it were mutated to "" the
// reported operation would differ, so we assert the EXACT operation string.
// ===========================================================================

describe("retryTransport surfaces the exact operation string for logBatch", () => {
  it('reports operation "logBatch" (not "") to onFallback on primary error', async () => {
    resetLoggerMetaStats();
    const onFallback = vi.fn<NonNullable<RetryTransportOptions["onFallback"]>>();
    const primary: Transport = {
      name: "remote",
      logBatch() {
        throw new Error("batch down");
      },
    };
    const fallbackBatches: string[][] = [];
    const fallback: Transport = {
      name: "local",
      logBatch(es) {
        fallbackBatches.push(es.map((e) => e.id));
      },
    };

    await retryTransport(primary, { maxRetries: 0, fallback, onFallback }).logBatch?.(
      [event, secondEvent],
      createContext(),
    );

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith({
      reason: "primary-error",
      operation: "logBatch",
      error: expect.any(Error),
    });
    expect(fallbackBatches).toEqual([["evt-1", "evt-2"]]);
  });
});

// ===========================================================================
// fallbackTransport.write / .logBatch wrapper methods (lines 154-165): assert
// the EXACT operation string the wrapper forwards to deliverWithFallback, so
// mutating "write" -> "" or "logBatch" -> "" changes the reported operation.
// ===========================================================================

describe("fallbackTransport write/logBatch wrappers forward the exact operation", () => {
  it('write() forwards operation "write" (record reaches fallback on primary error)', async () => {
    resetLoggerMetaStats();
    const onFallback = vi.fn<NonNullable<FallbackOnFallback>>();
    const fallbackSeen: number[] = [];
    const primary: Transport = {
      name: "p",
      write() {
        throw new Error("down");
      },
    };
    const fallback: Transport = { name: "f", write: (r) => void fallbackSeen.push(r.seq) };

    await fallbackTransport(primary, fallback, { onFallback }).write?.(record, createContext());

    expect(onFallback).toHaveBeenCalledWith({ operation: "write", error: expect.any(Error) });
    expect(fallbackSeen).toEqual([1]);
  });

  it('logBatch() forwards operation "logBatch" (events reach fallback on primary error)', async () => {
    resetLoggerMetaStats();
    const onFallback = vi.fn<NonNullable<FallbackOnFallback>>();
    const fallbackSeen: string[][] = [];
    const primary: Transport = {
      name: "p",
      logBatch() {
        throw new Error("down");
      },
    };
    const fallback: Transport = {
      name: "f",
      logBatch: (es) => void fallbackSeen.push(es.map((e) => e.id)),
    };

    await fallbackTransport(primary, fallback, { onFallback }).logBatch?.(
      [event, secondEvent],
      createContext(),
    );

    expect(onFallback).toHaveBeenCalledWith({ operation: "logBatch", error: expect.any(Error) });
    expect(fallbackSeen).toEqual([["evt-1", "evt-2"]]);
  });
});

// ===========================================================================
// retryTransport lifecycle hooks (lines 271-282): flush/flushSync/close delegate
// to inner then fallback (optional-chained). Assert exact call ordering so the
// BlockStatement / OptionalChaining mutants die.
// ===========================================================================

describe("retryTransport lifecycle delegation", () => {
  it("flush/flushSync/close call inner THEN fallback in order", async () => {
    const calls: string[] = [];
    const inner: Transport = {
      name: "inner",
      log() {},
      async flush() {
        calls.push("inner:flush");
      },
      flushSync() {
        calls.push("inner:flushSync");
      },
      async close() {
        calls.push("inner:close");
      },
    };
    const fallback: Transport = {
      name: "fb",
      log() {},
      async flush() {
        calls.push("fb:flush");
      },
      flushSync() {
        calls.push("fb:flushSync");
      },
      async close() {
        calls.push("fb:close");
      },
    };
    const transport = retryTransport(inner, { fallback });

    await transport.flush?.();
    transport.flushSync?.();
    await transport.close?.();

    expect(calls).toEqual([
      "inner:flush",
      "fb:flush",
      "inner:flushSync",
      "fb:flushSync",
      "inner:close",
      "fb:close",
    ]);
  });

  it("lifecycle hooks tolerate an inner without the methods (optional chaining)", async () => {
    const inner: Transport = { name: "inner", log() {} }; // no flush/flushSync/close
    const transport = retryTransport(inner);
    await expect(transport.flush?.()).resolves.toBeUndefined();
    expect(() => transport.flushSync?.()).not.toThrow();
    await expect(transport.close?.()).resolves.toBeUndefined();
  });

  it("lifecycle hooks tolerate a PRESENT fallback lacking the methods (inner ?. real)", async () => {
    const calls: string[] = [];
    const inner: Transport = {
      name: "inner",
      log() {},
      async flush() {
        calls.push("inner:flush");
      },
      flushSync() {
        calls.push("inner:flushSync");
      },
      async close() {
        calls.push("inner:close");
      },
    };
    // Fallback object exists but defines none of flush/flushSync/close: the inner
    // `?.` (fallback?.flush?.()) must guard the missing method, not throw.
    const fallback: Transport = { name: "fb", log() {} };
    const transport = retryTransport(inner, { fallback });

    await expect(transport.flush?.()).resolves.toBeUndefined();
    expect(() => transport.flushSync?.()).not.toThrow();
    await expect(transport.close?.()).resolves.toBeUndefined();
    expect(calls).toEqual(["inner:flush", "inner:flushSync", "inner:close"]);
  });

  it("lifecycle hooks tolerate a missing fallback entirely (fallback?.flush optional)", async () => {
    const calls: string[] = [];
    const inner: Transport = {
      name: "inner",
      log() {},
      async flush() {
        calls.push("inner:flush");
      },
      flushSync() {
        calls.push("inner:flushSync");
      },
      async close() {
        calls.push("inner:close");
      },
    };
    const transport = retryTransport(inner); // no fallback option at all

    await expect(transport.flush?.()).resolves.toBeUndefined();
    expect(() => transport.flushSync?.()).not.toThrow();
    await expect(transport.close?.()).resolves.toBeUndefined();
    expect(calls).toEqual(["inner:flush", "inner:flushSync", "inner:close"]);
  });
});
