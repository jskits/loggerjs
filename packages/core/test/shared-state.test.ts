import { afterEach, describe, expect, it, vi } from "vitest";
import * as primary from "../src";

// A second, independently evaluated copy of the core module graph stands in
// for an ESM app with a CJS library, two installed versions of
// @loggerjs/core, or two micro-frontends that each bundle their own copy.
async function loadSecondCopy(): Promise<typeof primary> {
  vi.resetModules();
  const copy = (await import("../src")) as typeof primary;
  expect(copy.configure).not.toBe(primary.configure);
  return copy;
}

describe("state across core copies", () => {
  afterEach(async () => {
    await primary.configure({ shareAcrossCopies: false });
    await primary.resetLoggerRegistry();
    primary.resetContextManager();
    primary.setContextProvider(undefined);
    primary.resetLoggerMetaStats();
    vi.restoreAllMocks();
  });

  it("keeps copies isolated by default and warns once that other copies are loaded", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const copy = await loadSecondCopy();
    const sink = primary.memoryTransport({ name: "memory" });

    await primary.configure({ transports: [sink] });
    await primary.configure({ transports: [sink] });
    copy.getLogger("library").info("from library");
    primary.getLogger("app").info("from app");

    expect(sink.events.map((event) => event.message)).toEqual(["from app"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("shareAcrossCopies");
  });

  it("delivers library getLogger() calls to a configuration shared across copies", async () => {
    const copy = await loadSecondCopy();
    const sink = primary.memoryTransport({ name: "memory" });

    await primary.configure({ transports: [sink], shareAcrossCopies: true });
    primary.getLogger("app").info("from app");
    copy.getLogger("library").info("from library");

    expect(sink.events.map((event) => event.message)).toEqual(["from app", "from library"]);
  });

  it("carries a registry configured before sharing into the shared store", async () => {
    const copy = await loadSecondCopy();
    const closeFirst = vi.fn<() => void>();
    const first = { name: "first", log: () => {}, close: closeFirst };
    const second = primary.memoryTransport({ name: "second" });

    await primary.configure({ transports: [first], shareAcrossCopies: false });
    await primary.configure({ transports: [second], shareAcrossCopies: true });
    copy.getLogger("library").info("after sharing");

    // The earlier configuration was found and replaced, not leaked.
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(second.events.map((event) => event.message)).toEqual(["after sharing"]);
  });

  it("lets either copy reset a shared registry", async () => {
    const copy = await loadSecondCopy();
    const sink = primary.memoryTransport({ name: "memory" });

    await primary.configure({ transports: [sink], shareAcrossCopies: true });
    await copy.resetLoggerRegistry();
    primary.getLogger("app").info("after reset");

    expect(sink.events).toHaveLength(0);
  });

  it("shares ambient context and meta counters only when sharing is on", async () => {
    const copy = await loadSecondCopy();
    const sink = primary.memoryTransport({ name: "memory" });
    const logger = copy.createLogger({ transports: [sink] });

    await primary.configure({ shareAcrossCopies: true });
    copy.setContextProvider(() => ({ tenant: "acme" }));
    primary.withContext({ requestId: "r-1" }, () => logger.info("scoped"));
    copy.incrementLoggerMetaCounter("shared.test");

    expect(sink.events[0]?.context).toMatchObject({ tenant: "acme", requestId: "r-1" });
    expect(primary.getLoggerMetaStats()["shared.test"]).toBe(1);

    await primary.configure({ shareAcrossCopies: false });
    copy.incrementLoggerMetaCounter("isolated.test");
    expect(primary.getLoggerMetaStats()["isolated.test"]).toBeUndefined();
  });

  it("keeps copies isolated without a warning when shareAcrossCopies is false", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const copy = await loadSecondCopy();
    const app = primary.memoryTransport({ name: "app" });
    const other = copy.memoryTransport({ name: "other" });

    await primary.configure({ transports: [app], shareAcrossCopies: false });
    await copy.configure({ transports: [other], shareAcrossCopies: false });
    primary.getLogger("app").info("app event");
    copy.getLogger("other").info("other event");

    expect(app.events.map((event) => event.message)).toEqual(["app event"]);
    expect(other.events.map((event) => event.message)).toEqual(["other event"]);
    expect(warn).not.toHaveBeenCalled();
  });
});
