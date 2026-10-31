import { expect, test, type Page } from "@playwright/test";
import type { IndexedDbFailure } from "../../examples/browser-basic/src/e2e-indexeddb-failure-fixture";

async function openHarness(page: Page) {
  await page.route("**/e2e-indexeddb-failure-harness.html", async (route) => {
    await route.fulfill({
      body: '<!doctype html><script type="module" src="/src/e2e-indexeddb-failure-fixture.ts"></script>',
      contentType: "text/html",
    });
  });
  await page.goto("/e2e-indexeddb-failure-harness.html");
  await page.waitForFunction(() => Boolean(window.loggerjsIndexedDbFailureE2e));
}

test.describe("IndexedDB transaction rejection handling", () => {
  for (const operation of ["write", "count", "sessions", "request", "transaction"] as const) {
    test(`preserves ${operation} failures without an extra unhandled rejection`, async ({
      page,
    }) => {
      await openHarness(page);
      const result = await page.evaluate(
        ({ dbName, failure }: { dbName: string; failure: IndexedDbFailure }) =>
          window.loggerjsIndexedDbFailureE2e.runFailure(dbName, failure),
        { dbName: `indexeddb-${operation}-${Date.now()}`, failure: operation },
      );

      expect(result.unhandled).toEqual([]);
      expect(result.countAfterFailure).toBe(0);
      expect(result.sessionsAfterFailure).toEqual([]);
      expect(result.recoveredCount).toBe(1);
      if (operation === "transaction") {
        expect(result.errorMessage).toBe("IndexedDB transaction aborted");
      } else if (operation === "request") {
        expect(result.errorName).toBe("ConstraintError");
      } else {
        expect(result.errorName).toBe("QuotaExceededError");
        expect(result.sameError).toBe(true);
      }
      if (operation === "write" || operation === "request") {
        const reason = operation === "write" ? "quota" : "write-failed";
        expect(result.dropped).toEqual([
          ["first", reason],
          ["second", reason],
        ]);
        expect(result.stats).toMatchObject({ dropped: 2, flushErrors: 1, persisted: 0 });
      }
    });
  }

  test("a handled write failure does not feed back through browser error capture", async ({
    page,
  }) => {
    await openHarness(page);
    const result = await page.evaluate(
      (dbName) => window.loggerjsIndexedDbFailureE2e.runErrorCapture(dbName),
      `indexeddb-error-capture-${Date.now()}`,
    );

    expect(result.unhandled).toBe(0);
    expect(result.captured).toEqual(["one application log"]);
    expect(result.internalErrors).toBe(1);
  });
});
