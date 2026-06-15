import { expect, test, type Page } from "@playwright/test";

interface CapturedLogEvent {
  message?: string;
}

interface BeaconCapture {
  url: string;
  events: CapturedLogEvent[];
  body: string;
}

interface ServiceWorkerResult {
  supported: boolean;
  messages: string[];
}

interface LoggerJsE2eApi {
  queueIndexedDbOfflineLog: (dbName: string, message: string) => Promise<number>;
  replayIndexedDbOfflineLog: (dbName: string) => Promise<number>;
  runBeaconPagehide: (message: string) => Promise<BeaconCapture[]>;
  runServiceWorkerTransport: (message: string) => Promise<ServiceWorkerResult>;
}

declare global {
  interface Window {
    loggerjsE2e: LoggerJsE2eApi;
  }
}

function parseLogEvents(body: string | null): CapturedLogEvent[] {
  if (!body) return [];
  const parsed = JSON.parse(body) as CapturedLogEvent | CapturedLogEvent[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function openHarness(page: Page) {
  await page.route("**/e2e-harness.html", async (route) => {
    await route.fulfill({
      body: `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body><script type="module" src="/src/e2e-fixture.ts"></script></body>
</html>`,
      contentType: "text/html",
    });
  });
  await page.goto("/e2e-harness.html");
  await page.waitForFunction(() => Boolean(window.loggerjsE2e));
}

test("IndexedDB offline queue survives reload and replays from a real browser", async ({
  page,
}) => {
  const runId = `persistent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dbName = `loggerjs-e2e-${runId}`;
  const message = `persistent offline replay ${runId}`;
  const capturedEvents: CapturedLogEvent[] = [];
  let failRemote = true;

  await page.route("**/api/e2e-persistent-logs", async (route) => {
    if (failRemote) {
      await route.fulfill({ body: "offline", status: 503 });
      return;
    }
    capturedEvents.push(...parseLogEvents(route.request().postData()));
    await route.fulfill({ body: "", status: 204 });
  });

  await openHarness(page);
  const queuedSize = await page.evaluate(
    ({ databaseName, logMessage }) => {
      return window.loggerjsE2e.queueIndexedDbOfflineLog(databaseName, logMessage);
    },
    { databaseName: dbName, logMessage: message },
  );
  expect(queuedSize).toBe(1);

  failRemote = false;
  await page.reload();
  await page.waitForFunction(() => Boolean(window.loggerjsE2e));
  const remainingSize = await page.evaluate((name) => {
    return window.loggerjsE2e.replayIndexedDbOfflineLog(name);
  }, dbName);

  expect(remainingSize).toBe(0);
  expect(capturedEvents.map((event) => event.message)).toContain(message);
});

test("pagehide uses sendBeacon with the queued browser HTTP payload", async ({ page }) => {
  const message = `pagehide beacon ${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await openHarness(page);
  const captures = await page.evaluate((input) => {
    return window.loggerjsE2e.runBeaconPagehide(input);
  }, message);

  expect(captures).toHaveLength(1);
  expect(captures[0]?.url).toBe("/api/e2e-beacon-logs");
  expect(captures[0]?.body).toContain(message);
  expect(captures[0]?.events.map((event) => event.message)).toContain(message);
});

test("service worker transport posts logs to an active worker in a real browser", async ({
  page,
}) => {
  const message = `service worker transport ${Date.now()}-${Math.random().toString(36).slice(2)}`;

  await openHarness(page);
  const supported = await page.evaluate(() => "serviceWorker" in navigator);
  test.skip(!supported, "service workers are not available in this browser project");

  const result = await page.evaluate((input) => {
    return window.loggerjsE2e.runServiceWorkerTransport(input);
  }, message);

  expect(result.supported).toBe(true);
  expect(result.messages).toContain(message);
});
