import { expect, test, type Page } from "@playwright/test";

interface CapturedLogEvent {
  message?: string;
}

interface BeaconCapture {
  url: string;
  events: CapturedLogEvent[];
  body: string;
}

interface SupportExportManifestSession {
  logCount?: number;
  logFileName?: string;
  sessionId?: string;
}

interface SupportExportManifest {
  logCount?: number;
  recentLogFileName?: string;
  sessionCount?: number;
  sessions?: SupportExportManifestSession[];
}

interface SupportExportResult {
  files: Record<string, string>;
  manifest: SupportExportManifest;
  queriedMessages: string[];
  recentMessages: string[];
  sessionFiles: string[];
  sessionIds: string[];
}

interface SupportSpillDrainResult {
  drainedMessages: string[];
  sessionIds: string[];
  storageAfterDrain: string | null;
}

interface ServiceWorkerResult {
  supported: boolean;
  messages: string[];
}

interface LoggerJsE2eApi {
  drainIndexedDbSupportSpill: (
    dbName: string,
    namespace: string,
  ) => Promise<SupportSpillDrainResult>;
  queueIndexedDbOfflineLog: (dbName: string, message: string) => Promise<number>;
  replayIndexedDbOfflineLog: (dbName: string) => Promise<number>;
  runBeaconPagehide: (message: string) => Promise<BeaconCapture[]>;
  runIndexedDbSupportExport: (
    dbName: string,
    sessionId: string,
    messagePrefix: string,
  ) => Promise<SupportExportResult>;
  runServiceWorkerTransport: (message: string) => Promise<ServiceWorkerResult>;
  writeIndexedDbSupportSpill: (
    dbName: string,
    namespace: string,
    message: string,
  ) => Promise<string[]>;
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

test("IndexedDB support store queries sessions and exports ZIP files in a real browser", async ({
  page,
}) => {
  const runId = `support-export-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dbName = `loggerjs-e2e-${runId}`;
  const sessionId = `session-${runId}`;
  const messagePrefix = `support export ${runId}`;
  const firstMessage = `${messagePrefix} first`;
  const secondMessage = `${messagePrefix} second`;

  await openHarness(page);
  const result = await page.evaluate(
    ({ databaseName, pageSessionId, prefix }) => {
      return window.loggerjsE2e.runIndexedDbSupportExport(databaseName, pageSessionId, prefix);
    },
    { databaseName: dbName, pageSessionId: sessionId, prefix: messagePrefix },
  );

  expect(result.queriedMessages).toEqual([firstMessage, secondMessage]);
  expect(result.sessionIds).toContain(sessionId);
  expect(Object.keys(result.files)).toEqual(
    expect.arrayContaining([
      "logs.ndjson",
      "manifest.json",
      "recent.ndjson",
      `sessions/${sessionId}/logs.ndjson`,
    ]),
  );
  expect(result.sessionFiles).toContain(`sessions/${sessionId}/logs.ndjson`);
  expect(result.recentMessages).toEqual([firstMessage, secondMessage]);
  expect(result.files["logs.ndjson"]).toContain(firstMessage);
  expect(result.files[`sessions/${sessionId}/logs.ndjson`]).toContain(secondMessage);
  expect(result.manifest).toMatchObject({
    logCount: 2,
    recentLogFileName: "recent.ndjson",
    sessionCount: 1,
  });
  expect(result.manifest.sessions).toEqual([
    expect.objectContaining({
      logCount: 2,
      logFileName: `sessions/${sessionId}/logs.ndjson`,
      sessionId,
    }),
  ]);
});

test("localStorage spill survives reload and drains into IndexedDB support logs", async ({
  page,
}) => {
  const runId = `support-spill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dbName = `loggerjs-e2e-${runId}`;
  const namespace = `${dbName}:support-spill`;
  const message = `support spill ${runId}`;

  await openHarness(page);
  const spilledMessages = await page.evaluate(
    ({ databaseName, spillNamespace, logMessage }) => {
      return window.loggerjsE2e.writeIndexedDbSupportSpill(
        databaseName,
        spillNamespace,
        logMessage,
      );
    },
    { databaseName: dbName, logMessage: message, spillNamespace: namespace },
  );

  expect(spilledMessages).toContain(message);

  await page.reload();
  await page.waitForFunction(() => Boolean(window.loggerjsE2e));
  const result = await page.evaluate(
    ({ databaseName, spillNamespace }) => {
      return window.loggerjsE2e.drainIndexedDbSupportSpill(databaseName, spillNamespace);
    },
    { databaseName: dbName, spillNamespace: namespace },
  );

  expect(result.drainedMessages).toContain(message);
  expect(result.sessionIds).toContain("spill-session");
  expect(result.storageAfterDrain).toBeNull();
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
