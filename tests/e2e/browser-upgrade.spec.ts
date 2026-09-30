import { expect, test, type Page } from "@playwright/test";
import type { UpgradedSupportLogs } from "../../examples/browser-basic/src/e2e-upgrade-current";
// Type-only: brings in the fixture's Window declaration without running it.
import type { PreviousReleaseFixture } from "../../examples/browser-basic/src/e2e-upgrade-previous";

// Data a user's browser stored with the previous release must survive an
// upgrade: the persisted IndexedDB formats are a compatibility contract that
// TypeScript API reports cannot see. The previous release is installed in
// examples/browser-basic as @loggerjs/browser-previous; bump that alias to
// the last published version when releasing.

async function openFixture(page: Page, name: string, global: string) {
  await page.route(`**/${name}.html`, async (route) => {
    await route.fulfill({
      body: `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body><script type="module" src="/src/${name}.ts"></script></body>
</html>`,
      contentType: "text/html",
    });
  });
  await page.goto(`/${name}.html`);
  await page.waitForFunction(
    (key) => Boolean((window as unknown as Record<string, unknown>)[key]),
    global,
  );
}

const openPrevious = (page: Page) => openFixture(page, "e2e-upgrade-previous", "loggerjsPrevious");
const openCurrent = (page: Page) => openFixture(page, "e2e-upgrade-current", "loggerjsCurrent");

function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

test("the current indexedDbTransport reads and extends logs stored by the previous release", async ({
  page,
}) => {
  const dbName = uniqueName("upgrade-support");
  const sessionId = "session-before-upgrade";

  await openPrevious(page);
  await page.evaluate(
    ({ name, session }) =>
      window.loggerjsPrevious.writeSupportLogs(name, session, ["stored 1", "stored 2", "stored 3"]),
    { name: dbName, session: sessionId },
  );

  await openCurrent(page);
  const upgraded: UpgradedSupportLogs = await page.evaluate(
    ({ name, session }) =>
      window.loggerjsCurrent.readAndExtendSupportLogs(name, session, "written after upgrade"),
    { name: dbName, session: sessionId },
  );

  expect(upgraded.messages).toEqual(["stored 1", "stored 2", "stored 3", "written after upgrade"]);
  expect(upgraded.sessions).toEqual([{ sessionId, count: 4 }]);
});

test("the current browserHttpTransport replays an offline queue stored by the previous release", async ({
  page,
}) => {
  const dbName = uniqueName("upgrade-offline");
  const url = `/api/${uniqueName("upgrade-collector")}`;
  let collectorUp = false;
  const received: string[] = [];
  await page.route(`**${url}`, async (route) => {
    if (!collectorUp) {
      await route.fulfill({ status: 503, body: "" });
      return;
    }
    const events = JSON.parse(route.request().postData() ?? "[]") as Array<{ message: string }>;
    received.push(...events.map((event) => event.message));
    await route.fulfill({ status: 204, body: "" });
  });

  await openPrevious(page);
  const queued: Awaited<ReturnType<PreviousReleaseFixture["queueOfflineLogs"]>> =
    await page.evaluate(
      ({ name, collectorUrl }) =>
        window.loggerjsPrevious.queueOfflineLogs(name, collectorUrl, ["queued 1", "queued 2"]),
      { name: dbName, collectorUrl: url },
    );
  expect(queued).toBeGreaterThan(0);

  collectorUp = true;
  await openCurrent(page);
  const remaining = await page.evaluate(
    ({ name, collectorUrl }) => window.loggerjsCurrent.replayOfflineLogs(name, collectorUrl),
    { name: dbName, collectorUrl: url },
  );

  expect(remaining).toBe(0);
  expect(received).toEqual(["queued 1", "queued 2"]);
});
