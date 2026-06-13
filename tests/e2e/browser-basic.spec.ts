import { expect, test } from "@playwright/test";

interface CapturedLogEvent {
  levelName?: string;
  logger?: string;
  message?: string;
  data?: unknown;
  tags?: Record<string, unknown>;
}

function parseLogEvents(body: string | null): CapturedLogEvent[] {
  if (!body) return [];
  const parsed = JSON.parse(body) as CapturedLogEvent | CapturedLogEvent[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

test("browser example sends logs from a real browser bundle", async ({ page }) => {
  const capturedEvents: CapturedLogEvent[] = [];
  const capturedBodies: string[] = [];

  await page.route("**/api/logs", async (route) => {
    const body = route.request().postData();
    if (body) {
      capturedBodies.push(body);
      capturedEvents.push(...parseLogEvents(body));
    }
    await route.fulfill({ status: 204, body: "" });
  });

  await page.route("**/api/does-not-exist", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "text/plain",
      body: "service unavailable",
    });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "manual log" })).toBeVisible();

  await page.getByRole("button", { name: "manual log" }).click();
  await page.getByRole("button", { name: "fetch error" }).click();

  await expect
    .poll(() => capturedEvents.map((event) => event.message), {
      message: "expected browser example to POST captured log events",
    })
    .toEqual(
      expect.arrayContaining([
        'console warning captured {"feature":"demo"}',
        "button clicked",
        "Fetch 503 GET /api/does-not-exist",
      ]),
    );

  expect(capturedEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        logger: "web",
        levelName: "info",
        message: "button clicked",
        tags: expect.objectContaining({ app: "demo", env: "local" }),
      }),
      expect.objectContaining({
        levelName: "warn",
        message: "Fetch 503 GET /api/does-not-exist",
      }),
    ]),
  );

  expect(capturedBodies.join("\n")).not.toContain("client-secret");
  expect(capturedBodies.join("\n")).toContain("[REDACTED]");
});
