import { expect, test, type Page, type Route } from "@playwright/test";
import type {
  ConservationResult,
  IndexedDbQuotaResult,
  VersionUpgradeResult,
} from "../../examples/browser-basic/src/e2e-failure-fixture";

type Fault = "ok" | "server-error" | "reset" | "hang";

async function openFailureHarness(page: Page) {
  await page.route("**/e2e-failure-harness.html", async (route) => {
    await route.fulfill({
      body: `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body><script type="module" src="/src/e2e-failure-fixture.ts"></script></body>
</html>`,
      contentType: "text/html",
    });
  });
  await page.goto("/e2e-failure-harness.html");
  await page.waitForFunction(() => Boolean(window.loggerjsFailureE2e));
}

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

// Answers collector requests with the planned fault. Only events in requests
// answered with 2xx count as acknowledged; hung requests are never answered.
async function routeCollector(page: Page, url: string, plan: (request: number) => Fault) {
  const acknowledged = new Set<string>();
  let requests = 0;
  await page.route(`**${url}`, async (route: Route) => {
    const fault = plan(requests);
    requests += 1;
    if (fault === "hang") return;
    if (fault === "reset") {
      await route.abort("connectionreset");
      return;
    }
    if (fault === "server-error") {
      await route.fulfill({ status: 503, body: "" });
      return;
    }
    const events = JSON.parse(route.request().postData() ?? "[]") as Array<{ id: string }>;
    for (const event of events) acknowledged.add(event.id);
    await route.fulfill({ status: 204, body: "" });
  });
  return { acknowledged, requestCount: () => requests };
}

// Conservation: each emitted event was acknowledged, reported through onDrop,
// or handed to navigator.sendBeacon (which close() uses and which cannot
// report delivery), and the collector never acknowledged an unknown event.
function expectConserved(result: ConservationResult, acknowledged: Set<string>) {
  const accounted = new Set([...result.dropped.map(([id]) => id), ...result.beaconed]);
  const emitted = new Set(result.emitted);
  expect(result.emitted.filter((id) => !acknowledged.has(id) && !accounted.has(id))).toEqual([]);
  expect([...acknowledged].filter((id) => !emitted.has(id))).toEqual([]);
}

test.describe("browser transports under injected failures", () => {
  test("a collector that never answers times out instead of hanging close()", async ({ page }) => {
    const url = `/api/${uniqueName("hang")}`;
    const collector = await routeCollector(page, url, () => "hang");
    await openFailureHarness(page);

    const result = await page.evaluate(
      (collectorUrl) =>
        window.loggerjsFailureE2e.runHttpConservation({
          url: collectorUrl,
          count: 8,
          timeoutMs: 300,
          closeBudgetMs: 5_000,
        }),
      url,
    );

    expect(result.closeSettled).toBe(true);
    expect(collector.acknowledged.size).toBe(0);
    expect(result.dropped.every(([, reason]) => reason === "closed")).toBe(true);
    expectConserved(result, collector.acknowledged);
  });

  for (const seed of [1, 2, 3]) {
    test(`conserves events under random collector faults (seed ${seed})`, async ({ page }) => {
      const random = mulberry32(seed);
      const faults: Fault[] = ["ok", "ok", "server-error", "reset", "hang"];
      const url = `/api/${uniqueName("chaos")}`;
      const collector = await routeCollector(
        page,
        url,
        () => faults[Math.floor(random() * faults.length)] ?? "ok",
      );
      await openFailureHarness(page);

      const result = await page.evaluate(
        (collectorUrl) =>
          window.loggerjsFailureE2e.runHttpConservation({
            url: collectorUrl,
            count: 40,
            timeoutMs: 300,
            closeBudgetMs: 10_000,
          }),
        url,
      );

      expect(result.closeSettled).toBe(true);
      expect(result.emitted).toHaveLength(40);
      expectConserved(result, collector.acknowledged);
    });
  }

  test("stores events while offline and replays them when the browser reconnects", async ({
    page,
    context,
  }) => {
    const url = `/api/${uniqueName("offline")}`;
    const received: string[] = [];
    await page.route(`**${url}`, async (route) => {
      const events = JSON.parse(route.request().postData() ?? "[]") as Array<{ message: string }>;
      received.push(...events.map((event) => event.message));
      await route.fulfill({ status: 204, body: "" });
    });
    await openFailureHarness(page);
    await page.evaluate(
      ({ dbName, collectorUrl }) =>
        window.loggerjsFailureE2e.startOfflineLogger(dbName, collectorUrl),
      { dbName: uniqueName("offline-db"), collectorUrl: url },
    );

    await context.setOffline(true);
    const messages = await page.evaluate(() => window.loggerjsFailureE2e.logOffline(12));
    expect(received).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => window.loggerjsFailureE2e.offlineQueueSize()))
      .toBeGreaterThan(0);

    await context.setOffline(false);
    await expect.poll(() => received.toSorted()).toEqual(messages.toSorted());
    await expect
      .poll(() => page.evaluate(() => window.loggerjsFailureE2e.offlineQueueSize()))
      .toBe(0);
  });

  test("an open IndexedDB transport does not block a newer version in another tab", async ({
    context,
  }) => {
    const dbName = uniqueName("versionchange");
    const olderTab = await context.newPage();
    const newerTab = await context.newPage();
    await openFailureHarness(olderTab);
    await openFailureHarness(newerTab);
    await olderTab.evaluate(
      (name) => window.loggerjsFailureE2e.holdIndexedDbTransport(name),
      dbName,
    );

    const upgrade: VersionUpgradeResult = await newerTab.evaluate(
      (name) => window.loggerjsFailureE2e.upgradeDatabase(name, 100),
      dbName,
    );

    expect(upgrade.outcome).toBe("upgraded");
    // The older tab keeps running; its writes may now fail against the newer
    // schema, but they must settle instead of hanging.
    const afterUpgrade = await olderTab.evaluate(() =>
      window.loggerjsFailureE2e.logToHeldTransport("after upgrade"),
    );
    expect(["ok", "rejected"]).toContain(afterUpgrade);
  });

  test("accounts for every event when IndexedDB runs out of quota", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Storage quota overrides need the Chrome DevTools Protocol",
    );
    await openFailureHarness(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Storage.overrideQuotaForOrigin", {
      origin: new URL(page.url()).origin,
      quotaSize: 512 * 1024,
    });

    const result: IndexedDbQuotaResult = await page.evaluate(
      (dbName) => window.loggerjsFailureE2e.runIndexedDbQuota(dbName, 60, 32 * 1024),
      uniqueName("quota"),
    );
    await cdp.send("Storage.overrideQuotaForOrigin", {
      origin: new URL(page.url()).origin,
    });

    const persisted = new Set(result.persisted);
    const dropped = new Map(result.dropped);
    expect(result.closeSettled).toBe(true);
    expect(result.emitted).toHaveLength(60);
    // The quota must actually have been hit for this test to mean anything.
    expect([...dropped.values()]).toContain("quota");
    expect(result.emitted.filter((id) => !persisted.has(id) && !dropped.has(id))).toEqual([]);
  });
});
